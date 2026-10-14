import { StatusTag, type Tone } from "@/components/brand/StatusTag";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { HeartPulse, Info } from "lucide-react";
import { Link } from "wouter";

const ORDER = { warning: 0, caution: 1, info: 2 } as const;
const TONE: Record<"warning" | "caution" | "info", Tone> = { warning: "negative", caution: "caution", info: "info" };
const LABEL = { warning: "Important", caution: "Caution", info: "Note" } as const;

/** Personal alerts for a scan, based on the user's profile. Wording is informational, never a safety verdict. */
export function HealthAlerts({ scanId }: { scanId: number }) {
  const { data, isLoading, error } = trpc.insights.healthAlerts.useQuery({ scanId }, { enabled: scanId > 0, retry: false });
  const alerts = data ? [...data.alerts].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]) : [];

  return (
    <section className="space-y-4 rounded-3xl bg-white p-5 md:p-7" aria-label="Alerts for you">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
          <HeartPulse className="h-5 w-5 text-signal-red-orange" />
        </span>
        <div className="min-w-0">
          <h2 className="fn-heading-sm text-graphite">Alerts for you</h2>
          <p className="text-sm text-muted-foreground">Points worth knowing, based on this product's ingredients and your profile.</p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-20 w-full rounded-2xl" />}
      {error && <p role="alert" className="text-sm text-signal-red-orange">{error.message}</p>}

      {data && !data.hasProfile && (
        <div className="flex flex-col gap-2 rounded-2xl bg-fog p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-graphite">
            Add your health conditions and medications to get alerts that fit you.
          </p>
          <Link href="/profile" className="inline-flex min-h-11 shrink-0 items-center text-sm font-bold text-graphite underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            Go to your profile
          </Link>
        </div>
      )}

      {data && alerts.length === 0 && (
        <p className="rounded-2xl bg-fog p-4 text-sm font-medium text-graphite">
          No personal alerts were found for this product. This does not mean it suits everyone.
        </p>
      )}

      {alerts.length > 0 && (
        <ul className="space-y-3">
          {alerts.map((a) => (
            <li key={a.id} className="space-y-2 rounded-2xl bg-fog p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusTag tone={TONE[a.severity]} onWhite>{LABEL[a.severity]}</StatusTag>
                <StatusTag tone="neutral" onWhite>{a.appliesTo}</StatusTag>
              </div>
              <p className="break-words font-bold text-graphite">{a.title}</p>
              <p className="break-words text-sm text-graphite">{a.message}</p>
              <dl className="space-y-0.5 text-sm text-muted-foreground">
                <div><dt className="inline font-bold text-graphite">Triggered by: </dt><dd className="inline break-words">{a.trigger}</dd></div>
                <div><dt className="inline font-bold text-graphite">Why: </dt><dd className="inline break-words">{a.reason}</dd></div>
                <div><dt className="inline font-bold text-graphite">Source: </dt><dd className="inline break-words">{a.source}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{data?.disclaimer ?? "This is general information, not medical advice. Check with your doctor, pharmacist or dietitian before changing your diet or medication."}</span>
      </p>
    </section>
  );
}
