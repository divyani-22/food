import { StatusTag } from "@/components/brand/StatusTag";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const FALLBACK_ZONES = [
  "UTC", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/London",
  "Europe/Berlin", "Africa/Johannesburg", "America/Sao_Paulo", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles",
];

function allTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const zones = fn ? fn("timeZone") : [];
    // Some browsers only list legacy names (Asia/Calcutta); merge the common modern names so people can find theirs.
    if (zones.length > 0) return Array.from(new Set(["UTC", ...zones, ...FALLBACK_ZONES])).sort((x, y) => (x === "UTC" ? -1 : y === "UTC" ? 1 : x.localeCompare(y)));
  } catch {
    /* fall through */
  }
  return FALLBACK_ZONES;
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

function useCountdown(expiresAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
}

function WhatsAppTitle() {
  return (
    <div className="flex items-start gap-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
        <MessageCircle className="h-5 w-5 text-verdant-green" />
      </span>
      <div className="min-w-0 space-y-1">
        <CardTitle className="fn-heading-sm">WhatsApp</CardTitle>
        <CardDescription>Get expiry reminders and send photos or receipts to the IngreScan bot.</CardDescription>
      </div>
    </div>
  );
}

export function WhatsAppCard() {
  const utils = trpc.useUtils();
  const status = trpc.whatsapp.status.useQuery();
  const createCode = trpc.whatsapp.createLinkCode.useMutation();
  const unlink = trpc.whatsapp.unlink.useMutation();
  const updatePrefs = trpc.whatsapp.updatePrefs.useMutation();

  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const secondsLeft = useCountdown(expiresAt);
  const zones = useMemo(allTimeZones, []);
  const s = status.data;

  // While a code is outstanding, poll so the card flips to "linked" once the user sends the message.
  const refetchRef = useRef(status.refetch);
  refetchRef.current = status.refetch;
  const waitingForLink = Boolean(createCode.data) && secondsLeft > 0 && s?.linked === false;
  useEffect(() => {
    if (!waitingForLink) return;
    const t = setInterval(() => void refetchRef.current(), 4000);
    return () => clearInterval(t);
  }, [waitingForLink]);

  const zoneOptions = useMemo(() => (s?.timezone && !zones.includes(s.timezone) ? [s.timezone, ...zones] : zones), [s?.timezone, zones]);

  const generate = async () => {
    try {
      const r = await createCode.mutateAsync();
      setExpiresAt(r.expiresAt);
      setCopied(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create a link code");
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`LINK ${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the code and copy it manually.");
    }
  };

  const savePrefs = async (input: { timezone?: string; reminderHour?: number; remindersEnabled?: boolean }) => {
    try {
      await updatePrefs.mutateAsync(input);
      await utils.whatsapp.status.invalidate();
      toast.success("WhatsApp settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    }
  };

  const disconnect = async () => {
    try {
      await unlink.mutateAsync();
      setExpiresAt(null);
      createCode.reset();
      await utils.whatsapp.status.invalidate();
      toast.success("WhatsApp disconnected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    }
  };

  const code = createCode.data;
  const codeActive = Boolean(code) && secondsLeft > 0;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(1, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <Card>
      <CardHeader><WhatsAppTitle /></CardHeader>
      <CardContent className="space-y-5">
        {status.isLoading && <Skeleton className="h-24 w-full rounded-2xl" />}
        {status.error && <p role="alert" className="text-sm text-signal-red-orange">{status.error.message}</p>}

        {s && !s.configured && (
          <div className="space-y-2 rounded-2xl bg-fog p-4">
            <StatusTag tone="neutral" onWhite>Not available</StatusTag>
            <p className="text-sm text-graphite">
              The WhatsApp bot is not configured on this server, so it cannot be linked yet. The server admin needs to set up the
              Twilio WhatsApp credentials first.
            </p>
          </div>
        )}

        {s && s.configured && !s.linked && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Link your WhatsApp number to get a daily reminder about food that is about to expire, and to scan products by sending a photo.
            </p>
            {!codeActive && (
              <Button onClick={generate} disabled={createCode.isPending} className="w-full sm:w-auto">
                {createCode.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {code ? "Generate a new code" : "Generate link code"}
              </Button>
            )}
            {code && !codeActive && <p className="text-sm text-muted-foreground">That code has expired. Generate a new one.</p>}
            {code && codeActive && (
              <div className="space-y-4 rounded-2xl bg-fog p-4 md:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="fn-metric break-all text-4xl tracking-widest text-graphite md:text-5xl" aria-label={`Link code ${code.code.split("").join(" ")}`}>{code.code}</p>
                  <Button variant="outline" onClick={() => copy(code.code)} aria-label="Copy the LINK message">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy message"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground" aria-live="off">Expires in {mm}:{ss}</p>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-graphite">
                  <li>Open WhatsApp on your phone.</li>
                  <li>Start a chat with <span className="font-bold">{code.botNumber ?? "the IngreScan bot number"}</span>.</li>
                  <li>Send the message <span className="font-bold">LINK {code.code}</span></li>
                </ol>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Waiting for your message. This card updates automatically.
                </p>
              </div>
            )}
          </div>
        )}

        {s && s.configured && s.linked && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-fog p-4">
              <StatusTag tone="positive" onWhite>Connected</StatusTag>
              <span className="font-bold text-graphite">{s.phoneMasked}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 md:gap-5">
              <div className="space-y-2">
                <Label htmlFor="wa-tz">Time zone</Label>
                <Select value={s.timezone ?? "UTC"} onValueChange={(v) => savePrefs({ timezone: v })} disabled={updatePrefs.isPending}>
                  <SelectTrigger id="wa-tz" className="w-full"><SelectValue placeholder="Select time zone" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {zoneOptions.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wa-hour">Reminder time</Label>
                <Select value={String(s.reminderHour ?? 8)} onValueChange={(v) => savePrefs({ reminderHour: Number(v) })} disabled={updatePrefs.isPending}>
                  <SelectTrigger id="wa-hour" className="w-full"><SelectValue placeholder="Select hour" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex min-h-11 items-center justify-between gap-4 rounded-2xl bg-fog px-4 py-2">
              <Label htmlFor="wa-reminders" className="min-w-0 flex-1 cursor-pointer">Daily expiry reminders</Label>
              <Switch
                id="wa-reminders"
                checked={Boolean(s.remindersEnabled)}
                onCheckedChange={(v) => savePrefs({ remindersEnabled: v })}
                disabled={updatePrefs.isPending}
                aria-label="Daily expiry reminders"
              />
            </div>
            <div className="flex justify-end border-t border-border pt-5">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="w-full text-signal-red-orange sm:w-auto" disabled={unlink.isPending}>Disconnect</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You will stop getting reminders and the bot will no longer recognise your number. You can link again at any time.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep connected</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>Disconnect</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
