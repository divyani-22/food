# FoodIQ / FreshGuard WhatsApp bot

Code: `IngreScan-AI/server/whatsapp/`. This document covers the architecture, configuration,
provider setup (Twilio sandbox and Meta Cloud API), the 24-hour window rule, the command
reference, the security model, limits, and what has NOT been verified.

The core is provider-neutral and I/O-free. It talks to the outside world only through three
injected interfaces (`Store`, `Services`, `Sender`, defined in `server/whatsapp/types.ts`).
The Express routes, DB-backed `Store`, and tRPC/Flask-backed `Services` are wired separately.

## 1. Architecture

```
 Twilio / Meta  --HTTP-->  Express route  --->  processTwilioWebhook / processMetaWebhook
                                                  | verify signature (HMAC)
                                                  | parse -> InboundMessage
                                                  v
                                             handleInbound(msg, deps)
                                                  | dedupe (Store.seenMessage)
                                                  | rate limit (token bucket per phone)
                                                  | resolve link (Store.getLink)
                                                  | parse command, state machine (Store)
                                                  | Services.* (classify, lookup, pantry ...)
                                                  v
                                       { status, body, contentType, outbound[] }
                                                  |
                          Express route:  deliver(sender, outbound)   (Sender.sendText)

 Scheduler (cron every 15 min) --> runReminders({store, sender, config})
                                     computeDueReminders -> session text OR template
```

| File | Purpose |
| --- | --- |
| `types.ts` | `Store`, `Services`, `Sender`, `BotConfig`, `HandlerDeps`, domain types |
| `phone.ts` | E.164 normalization, `whatsapp:` prefix handling |
| `security.ts` | SSRF guard, content-type allowlist, token bucket, constant-time compare |
| `commands.ts` | Pure command parser (`Command` union) |
| `barcode.ts` | GS1 check digit (EAN-8, UPC-A, EAN-13, GTIN-14) |
| `time.ts` | `Intl`-based timezone and local calendar math |
| `format.ts` | Message builders, markdown escaping, 4000-char chunking, optional emoji markers |
| `conversation.ts` | `handleInbound` orchestrator and state machine |
| `linking.ts` | Link-code generation, salted hashing, TTL, attempt limiter |
| `reminders.ts` | `computeDueReminders`, `runReminders`, template body text |
| `webhooks.ts` | `processTwilioWebhook`, `processMetaWebhook`, `deliver` |
| `providers/twilio.ts` | Twilio signature, webhook parsing, sender, media download |
| `providers/meta.ts` | Meta signature, hub challenge, webhook parsing, sender, 2-step media download |
| `providers/mediaFetch.ts` | Shared safe media downloader (per-hop SSRF check, size cap) |
| `testkit.ts` | In-memory fakes used by tests (not for production) |

## 2. Interfaces the application must implement

Defined precisely in `types.ts`.

`Store` (persistence)
- `seenMessage(provider, id) -> boolean`: atomically record the id; return true if it was already recorded (for example `INSERT ... ON CONFLICT DO NOTHING` and check the affected row count). Keep ids for at least 7 days.
- `getLink(phone) -> LinkRecord | null`: phone is E.164. `LinkRecord` carries `userId`, `timezone`, `reminderHour`, `remindersEnabled`, `lastInboundAt`, `lastReminderLocalDate`.
- `touchInbound(phone, at)`: set `lastInboundAt` (this drives the 24-hour window).
- `getConversation(phone)` / `setConversation(phone, state | null)`: single state slot per phone (`awaiting_add`, `awaiting_clear_choice`, `browsing_pantry`). Each state has its own `expiresAt`, which the core checks.
- `listReminderCandidates() -> ReminderLink[]`: linked users plus their active pantry items (expiry dates as local `YYYY-MM-DD`).
- `markReminded(phone, localDate)`.

`Services` (business logic)
- `classifyImage(img)`: Flask `POST /api/predict`; map `fruit`, `confidence` (percent), `freshness_status`, `shelf_life_days`, `storage_tips`, `cooking_tips`. Return null if unusable.
- `classifyOrExtract(img)`: for non-produce photos, decode a barcode (`{kind:"barcode"}`) or OCR an ingredient label (`{kind:"label_text"}`) or return `{kind:"unknown"}`.
- `lookupBarcode(userId, barcode)`: Open Food Facts plus risk analysis; `PackagedReport` or null.
- `analyzeIngredientsText(userId, text)`: `PackagedReport` (risk score 0-100, high-risk additives, allergens, personal alerts, optional healthier alternative).
- `listPantry(userId)`, `addPantryItem(userId, item)`, `clearPantryItem(userId, itemId)`, `rescueRecipes(userId, expiringItems)`.
- `linkAccount(code, phone)`: redeem the code (see `linking.ts`: `findMatchingLinkRecord`, `createLinkCode`), create the link, and return `{ok:true,userId}` or `{ok:false,reason}`.
- `getReminderPrefs(userId)` / `setReminderPrefs(userId, patch)`: MUST write the same row that `Store.getLink` and `Store.listReminderCandidates` read (timezone, hour, enabled), otherwise the TZ, REMIND, STOP and START commands will not affect reminders.
- `downloadMedia(media)`: delegate to `downloadTwilioMedia` or `downloadMetaMedia` according to `media.provider`.

`Sender`: `sendText(to, text)` and `sendTemplate(to, {name, language, variables})`. Use `createTwilioSender` or `createMetaSender`.

Any `Services` or `Store` method may throw; the orchestrator turns that into a generic apology and logs only the error class name.

## 3. What the Express layer must do

Routes to mount: `POST /api/whatsapp/twilio`, `POST /api/whatsapp/meta`, `GET /api/whatsapp/meta`.

1. Trust proxy: `app.set("trust proxy", 1)` when behind ngrok or a load balancer.
2. Raw body for Meta: signature verification is over the exact bytes. Mount with `express.raw({ type: "application/json" })` on the Meta route BEFORE any `express.json()`, and pass `req.body` (a Buffer) as `rawBody`. Never re-serialise parsed JSON.
3. Twilio body: mount `express.text({ type: "application/x-www-form-urlencoded" })` (or `express.raw`) on the Twilio route and pass the string as `formBody`. Do not let `express.urlencoded` consume it first.
4. Public URL for Twilio: Twilio signs the exact URL it requested. Build `url = PUBLIC_BASE_URL + req.originalUrl` (for example `https://abcd.ngrok-free.app/api/whatsapp/twilio`). Do not derive it from `req.protocol`/`Host` unless you trust the proxy headers. If a proxy changes the scheme, set `allowSchemeVariants: true` (off by default).
5. Call the processor and respond with `status`, `contentType`, `body`; then `await deliver(sender, result.outbound, log)`. Reply quickly: both providers retry on slow responses (the core dedupes retries by message id).
6. Do not log request bodies or media URLs (they contain phone numbers and message content).

```ts
const result = await processTwilioWebhook(
  { url, formBody: req.body as string, headers: req.headers },
  { ...handlerDeps, twilio: { authToken: env.TWILIO_AUTH_TOKEN, allowSchemeVariants: false } },
);
res.status(result.status).type(result.contentType).send(result.body);
void deliver(sender, result.outbound, handlerDeps.log);

const metaResult = await processMetaWebhook(
  { rawBody: req.body as Buffer, headers: req.headers, query: req.query as any, method: req.method as "GET" | "POST" },
  { ...handlerDeps, meta: { appSecret: env.META_APP_SECRET, verifyToken: env.META_VERIFY_TOKEN } },
);
```

`handlerDeps` = `{ store, services, config, rateLimiter: createDefaultRateLimiter(), linkLimiter: new AttemptLimiter(), log }`.

## 4. Environment variables (names only)

Read these in the wiring layer and pass them in as plain objects. The core never reads `process.env`.

```
# --- .env.example entries to add (placeholders only) ---
WHATSAPP_PROVIDER=twilio                 # twilio | meta
WHATSAPP_PUBLIC_BASE_URL=https://your-public-host.example   # no trailing slash
WHATSAPP_ALLOW_SCHEME_VARIANTS=false     # true only behind a scheme-rewriting proxy
WHATSAPP_REMINDER_TEMPLATE_NAME=pantry_expiry_reminder
WHATSAPP_REMINDER_TEMPLATE_LANG=en
WHATSAPP_MAX_MEDIA_BYTES=8388608

# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_FROM=+14155238886        # sandbox number, or your approved sender
TWILIO_CONTENT_SID_PANTRY_REMINDER=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # Content SID of the approved template

# Meta WhatsApp Cloud API
META_APP_SECRET=your_meta_app_secret
META_VERIFY_TOKEN=a_long_random_string_you_choose
META_ACCESS_TOKEN=your_system_user_access_token
META_PHONE_NUMBER_ID=your_phone_number_id
```

Use a long-lived System User token for Meta (temporary tokens expire in about 24 hours). Never commit real values.

## 5. Provider setup

### Twilio sandbox (fastest for testing)

1. Twilio Console, Messaging, Try it out, Send a WhatsApp message. Note the sandbox number and your join phrase.
2. From your phone, send `join <your-phrase>` to the sandbox number. Each tester must do this; sandbox sessions need re-joining after 72 hours.
3. Start the app and a tunnel (section 6).
4. In the sandbox settings set "When a message comes in" to `https://<tunnel-host>/api/whatsapp/twilio`, method POST.
5. Set `WHATSAPP_PUBLIC_BASE_URL` to exactly `https://<tunnel-host>` and restart.
6. Send `HELP` from your phone. You should get the connect-your-account guidance.

For production use a Twilio WhatsApp sender (Meta business verification required) and register the reminder template as a Content Template (section 7).

### Meta WhatsApp Cloud API

1. developers.facebook.com: create an app of type Business, add the WhatsApp product.
2. WhatsApp, API Setup: note the phone number id, add your test recipient number.
3. WhatsApp, Configuration, Webhook: callback URL `https://<tunnel-host>/api/whatsapp/meta`, verify token = your `META_VERIFY_TOKEN`. Meta performs the GET handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`); the app must be running first.
4. Subscribe to the `messages` webhook field.
5. App secret: App settings, Basic, for `META_APP_SECRET` (used for `X-Hub-Signature-256`).
6. Create a System User token with `whatsapp_business_messaging` for `META_ACCESS_TOKEN`.
7. Submit the reminder template (section 7) in WhatsApp Manager and wait for approval.

## 6. Local testing with ngrok

```
npx ngrok http 3000
```

Webhook URLs (replace the host with the one ngrok prints):

- Twilio: `https://<id>.ngrok-free.app/api/whatsapp/twilio`
- Meta: `https://<id>.ngrok-free.app/api/whatsapp/meta` (GET for verification, POST for events)

The free ngrok host changes on every start: update the provider console and `WHATSAPP_PUBLIC_BASE_URL` each time. If Twilio signature checks fail only locally, the first thing to compare is the exact URL string (scheme, host, path, query).

## 7. The 24-hour customer-service window and the reminder template

WhatsApp only allows free-form (session) messages within 24 hours of the user's last inbound message. Outside the window, a business-initiated message must be a pre-approved template.

The bot models this:
- Every inbound message from a linked user updates `lastInboundAt` (`Store.touchInbound`).
- `computeDueReminders` compares `now - lastInboundAt`. Under 24 hours: a session text (`mode: "session"`, sent with `Sender.sendText`). 24 hours or more, or never: a template (`mode: "template"`, sent with `Sender.sendTemplate`, template name and language from `BotConfig.reminderTemplate`).
- The replies the bot gives to user messages are always session messages and are always in the window.

Template to submit for approval (category: UTILITY, language: English `en`, one body variable, no header/footer/buttons required):

```
Name: pantry_expiry_reminder

Body:
Pantry reminder: these items are expiring soon: {{1}}. Reply COOK for a recipe, or STOP to turn off reminders.

Sample for {{1}}:
Milk (tomorrow), Spinach (today)
```

`{{1}}` is a single line: item names with "today", "tomorrow" or "in N days", comma separated, at most 5 items plus "and N more". WhatsApp rejects variables with newlines, tabs, or 4+ consecutive spaces; the formatter guarantees this.

On Twilio the template is a Content Template; map the template name to its Content SID (`contentSids` option of `createTwilioSender`, or pass the `HX...` SID as the template name). Opt-out wording is required by WhatsApp policy; STOP is handled by the bot.

Reminder rules (`reminders.ts`):
- Per-user IANA timezone and preferred local hour (default 9). Due when local hour >= preferred hour, so a delayed job still catches up the same day.
- At most one per local calendar day (`lastReminderLocalDate`; the job records the date BEFORE sending, so a failed send is not retried until the next day).
- Only for opted-in users. Quiet hours 21:00-08:00 local (configurable); the REMIND command refuses hours inside quiet hours.
- Only items expiring today through 2 days ahead (calendar days in the user's zone). Already-expired items are not included.
- Run `runReminders` from a scheduler every 5-15 minutes. With several app instances, make sure only one runs it, or make `markReminded` an atomic compare-and-set.

## 8. Commands

Case-insensitive, whitespace-trimmed, trailing punctuation ignored.

| Input | Effect |
| --- | --- |
| Photo of a fruit or vegetable | Inspection report (item, confidence, status, shelf life, storage tip). Below 50% confidence: retry guidance. |
| `ADD` | Save the last inspected item; expiry = today (user timezone) + shelf life. Valid for 15 minutes. Not offered for spoiled items. |
| Barcode digits (8-14) | Validated with the GS1 check digit, then looked up; risk report. Invalid check digit or length is explained. |
| Photo of a barcode or label | `Services.classifyOrExtract` decodes it, then same as above. |
| Pasted ingredients (`Ingredients: ...` or a comma list) | Risk report from the text. |
| `HELP` (also `HI`, `MENU`, `?`) | Command list. |
| `LINK <code>` | Connect this number to a web account. |
| `FRIDGE` / `PANTRY` [`page`] , `MORE` | List active items, most urgent first, with FRESH / EXPIRING SOON / EXPIRED. 8 items per page. |
| `COOK` / `RESCUE` | Recipes using items expiring within 2 days. |
| `CLEAR <item>` | Mark an item as used. Several matches: numbered choice (`awaiting_clear_choice`, 10 minutes), reply with the number or `CANCEL`. |
| `STOP` (also `UNSUBSCRIBE`, `QUIT`) / `START` | Opt out of / into proactive reminders. STOP is honoured even when rate limited. |
| `REMIND <0-23>` (also `8am`, `7pm`) | Preferred reminder hour. |
| `TZ <Region/City>` | Timezone, validated with `Intl.DateTimeFormat`. |
| anything else | Polite fallback pointing to `HELP`. |

Unlinked numbers receive only LINK/HELP guidance: open the web app, Profile, Connect WhatsApp, then send `LINK <code>`.

Link codes (`linking.ts`): 8 characters from an unambiguous alphabet (no I, L, O, 0, 1) generated with `crypto.randomInt`; stored only as `sha256(salt:code)` with a per-code salt; single use; 10 minute TTL; after 5 failed attempts per phone in 15 minutes further attempts are refused. Because salts are per code, look up candidates among the recently issued unexpired records with `findMatchingLinkRecord`.

Output style: no emoji anywhere. Styling is WhatsApp bold (`*TITLE*`), uppercase status words and `-` bullets. `BotConfig.useEmoji = true` adds colored circle markers from a small table in `format.ts` (written as escapes so the source stays emoji-free); it defaults to false.

## 9. Security model

- Webhook authenticity: Twilio `X-Twilio-Signature` = base64(HMAC-SHA1(authToken, url + sorted name+value pairs)); Meta `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(appSecret, raw body). Both compared in constant time. Unsigned or wrongly signed requests get 403 and are not processed. There is no "skip verification" switch.
- Meta GET handshake echoes `hub.challenge` only for a matching token and only if it matches `[A-Za-z0-9_-]{1,200}` (the value is reflected into the response).
- SSRF: media URLs must be `https`, port 443, no credentials, no IP literals, not localhost/.local/.internal, and the host must be on the provider allowlist (Twilio: `api.twilio.com`, `media.twiliocdn.com`, `*.twilio.com`; Meta: `lookaside.fbsbx.com`, `*.fbcdn.net`, `graph.facebook.com`). Redirects are followed manually (max 3) and every hop is re-checked; credentials are sent to the first host only. Checks are on the hostname literal, not DNS results: a DNS rebinding attack on an allowlisted provider domain is out of scope. For defence in depth also run the server with egress filtering.
- Media limits: 8 MB default (declared length and streamed bytes), content types `image/jpeg`, `image/png`, `image/webp` only.
- Replay/duplicates: de-duplicated by provider message id before rate limiting, so retries are free and cannot double-add items.
- Rate limiting: token bucket per phone (burst 8, then 1 message per 6 seconds), in memory.
- Errors: user-facing text never includes exception messages or stack traces; logs carry only the error class name. Phone numbers should be masked in logs (`maskPhone`).
- User-supplied names are neutralised before being placed in WhatsApp markdown (`*`, `_`, `~`, backtick are replaced with look-alike characters), newlines stripped, length capped.
- Secrets are injected, never hardcoded or logged. The core never reads `process.env`.
- Health advice is general information with a disclaimer; it is not medical advice.

## 10. Limits

- Message size: replies are split into chunks of at most 4000 characters at line boundaries (Meta limit 4096). Twilio WhatsApp bodies are limited to 1600 characters, so `createTwilioSender` re-splits to 1500.
- Rate limiter and link-attempt limiter are per process and in memory. Multi-instance deployments need a shared implementation behind the same `take`/`allowed`/`fail` shape.
- One conversation state slot per phone; a new photo replaces a pending ADD.
- CLEAR shows at most 9 candidates.
- Only one image per Twilio message is read (`MediaUrl0`); captions are ignored for photos.
- English only.
- Quiet hours and the 2-day reminder horizon are configurable through `BotConfig`.

## 11. What is NOT verified

- No live Twilio or Meta delivery was tested (no credentials or network here). Request shapes follow the public documentation of the Twilio Messages API, Twilio Content API (`ContentSid`, `ContentVariables`), and the Cloud API v20.0 `messages` endpoint; confirm them against a real sandbox before launch.
- The Twilio signature algorithm is verified against an independent computation (`openssl dgst -sha1 -hmac`) but NOT against an official Twilio test constant: the signature quoted in the task brief (`0/KCTR6DLpKmkAf8muzZqo1nDgQ=`) does not reproduce from the quoted inputs by either method, so it is not asserted anywhere. The test file documents this.
- Template approval, Twilio Content SID mapping, and real 24-hour window behaviour are untested.
- The orchestrator is tested with in-memory fakes of `Store`, `Services` and `Sender`. They test the bot logic, not the real DB, Flask service, Open Food Facts, or tRPC wiring.
- The DST and half-hour timezone tests rely on the ICU timezone data of the Node runtime.
- Express wiring (raw body capture, trust proxy, public URL) is described but not implemented or exercised here.
- Barcode decoding from images and OCR of labels are an interface (`classifyOrExtract`) only.
