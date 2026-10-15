# e2e scripts

Real-browser (Playwright, Chromium) and real-HTTP checks against the real Flask and Express/tRPC apps. No mocks of our own code; external services (Open Food Facts, Open Prices, Twilio) are replaced by local stubs or an unreachable local port. See `docs/ci.md` for how CI uses them.

## Run everything the way CI does

From the repo root, with `pip install -r requirements.txt`, `python tools/fetch_detector.py`, `pnpm install` in `IngreScan-AI/` and `playwright` available at the repo root (`npm install --no-save playwright@1.56.1`, then `npx playwright install chromium`):

    node e2e/run-ci.mjs                      # every SQLite script, fresh DB each
    node e2e/run-ci.mjs ui-ops ebill-import  # selected scripts
    node e2e/run-ci.mjs --list               # catalogue and ports
    node e2e/run-ci.mjs --db mysql           # barcode-scan and on-device-inference (need a MySQL/MariaDB server)

Logs, screenshots and SQLite files go to `$E2E_ARTIFACT_DIR` (default `<tmp>/e2e-artifacts/<script>/`). The runner uses ports 3450+n (web), 5450+n (Flask), 4450+n (stubs) where n is the script's index in `--list`, always tears down every process it started, prints a summary table and exits non-zero on any failure.

## Scripts

| script | stack | database |
|---|---|---|
| full-journey, produce-isolation, ui-features, ui-ops, multi-item | Flask + web app (started by run-ci) | SQLite |
| ebill-import | web app (started by run-ci) | SQLite |
| alt-market, whatsapp | start their own stack and stubs | SQLite |
| barcode-scan | starts its own app | MySQL/MariaDB (uses the `mysql` CLI directly) |
| on-device-inference | Flask + web app (started by run-ci) | MySQL/MariaDB (uses the `mysql` CLI directly) |

Each script's header comment documents running it by hand. `lib/db.mjs` is the shared SQL helper (MySQL via the CLI, SQLite via python3).
