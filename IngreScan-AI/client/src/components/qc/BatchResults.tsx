import { StatusTag } from "@/components/brand/StatusTag";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Download, ImageOff, Info, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  GRADES,
  GRADE_META,
  VERDICT_META,
  fruitLabel,
  triggerDownload,
  type QcSummary,
  type ResultPhoto,
  type Verdict,
} from "./types";

function Bar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-fog" role="presentation">
      <div className={cn("h-full rounded-full", className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function DownloadCsvButton({
  batchId,
  size = "default",
  kind = "summary",
}: {
  batchId: number;
  size?: "default" | "sm";
  kind?: "summary" | "photos";
}) {
  const utils = trpc.useUtils();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const file = await utils.qc.csv.fetch({ id: batchId, kind }, { staleTime: 0 });
          triggerDownload(file.filename, file.csv);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not download the CSV");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {kind === "photos" ? "Photo-level CSV" : "Download CSV"}
    </Button>
  );
}

export function BatchResults({
  summary,
  photos,
  batchId,
  notes,
  title,
}: {
  summary: QcSummary;
  photos: ResultPhoto[];
  batchId: number;
  notes?: string | null;
  title?: string;
}) {
  const verdict = VERDICT_META[summary.verdict as Verdict];
  const VerdictIcon = summary.verdict === "ACCEPT" ? CheckCircle2 : summary.verdict === "REJECT_LOT" ? ShieldAlert : AlertTriangle;
  const iconColor = summary.verdict === "ACCEPT" ? "text-verdant-green" : summary.verdict === "REJECT_LOT" ? "text-signal-red-orange" : "text-sunset-orange";
  const [filter, setFilter] = useState<"all" | (typeof GRADES)[number]>("all");
  const shown = filter === "all" ? photos : photos.filter((p) => p.grade === filter);

  return (
    <div className="space-y-6">
      <section aria-labelledby="verdict-heading" className="rounded-3xl border border-border bg-white p-5 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog">
              <VerdictIcon className={cn("h-5 w-5", iconColor)} aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-bold text-muted-foreground">
                {title ?? "Verdict"}
                {summary.vendor ? ` - ${summary.vendor}` : ""}
                {summary.lotId ? ` - lot ${summary.lotId}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <h2 id="verdict-heading" className="fn-heading-sm text-graphite" data-testid="verdict">
                  {summary.verdict}
                </h2>
                <StatusTag tone={verdict.tone} onWhite>
                  {verdict.label}
                </StatusTag>
              </div>
              <p className="text-base leading-relaxed text-graphite" data-testid="verdict-reason">
                {summary.verdictReason}
              </p>
              {notes ? <p className="text-sm text-muted-foreground">Notes: {notes}</p> : null}
            </div>
          </div>
          <DownloadCsvButton batchId={batchId} />
          <DownloadCsvButton batchId={batchId} kind="photos" />
        </div>

        {summary.lowSample && (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-fog p-4" role="note">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sunset-orange" aria-hidden="true" />
            <p className="text-sm font-medium text-graphite">
              Low sample: only {summary.totalPhotos} photo{summary.totalPhotos === 1 ? "" : "s"} graded, below the {summary.rule.acceptance.minSample} needed to be
              representative. Treat this verdict as provisional.
            </p>
          </div>
        )}
        {summary.warnings.map((w) => (
          <div key={w} className="mt-3 flex items-start gap-3 rounded-2xl bg-fog p-4" role="note">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-blue" aria-hidden="true" />
            <p className="text-sm font-medium text-graphite">{w}</p>
          </div>
        ))}
        <p className="mt-4 text-sm text-muted-foreground" data-testid="statistical-note">
          {summary.statisticalNote}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Photo grades inherit the classifier's errors. This supports your receiving decision; it does not replace physical inspection.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="fn-heading-sm">Grade distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {GRADES.map((g) => {
              const meta = GRADE_META[g];
              const n = summary.counts[g];
              const pct = summary.percentages[g];
              return (
                <div key={g} className="space-y-1.5" data-testid={`grade-${g}`}>
                  <div className="flex items-center justify-between gap-3">
                    <StatusTag tone={meta.tone}>{meta.label}</StatusTag>
                    <p className="text-sm text-muted-foreground">
                      <span className="fn-metric text-base text-graphite">{n}</span> photo{n === 1 ? "" : "s"} - {pct}%
                    </p>
                  </div>
                  <Bar pct={pct} className={meta.bar} />
                </div>
              );
            })}
            <p className="text-sm text-muted-foreground">A + B share: {summary.percentages.AB}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="fn-heading-sm">Freshness probability</CardTitle>
          </CardHeader>
          <CardContent>
            {summary.pFresh ? (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    ["Mean", summary.pFresh.mean],
                    ["Median", summary.pFresh.median],
                    ["Min", summary.pFresh.min],
                    ["Max", summary.pFresh.max],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-fog p-3">
                    <dt className="text-xs font-bold text-muted-foreground">{k}</dt>
                    <dd className="fn-metric mt-2 text-2xl text-graphite">{v}%</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No gradable photos.</p>
            )}
            {summary.rejectRateCi95 && (
              <p className="mt-4 text-sm text-muted-foreground">
                Reject share 95% interval: {summary.rejectRateCi95[0]}% to {summary.rejectRateCi95[1]}%.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="fn-heading-sm">How this was decided</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-graphite" data-testid="rule-description">
            {summary.rule.description}
          </p>
          <div className="overflow-x-auto rounded-2xl bg-fog p-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Required</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.checks.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="whitespace-normal font-medium">{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.actual}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.op} {c.limit}%
                    </TableCell>
                    <TableCell>
                      <StatusTag tone={c.passed ? "positive" : "negative"} onWhite>
                        {c.passed ? "Passed" : "Failed"}
                      </StatusTag>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Per-photo thresholds: grade A needs p_fresh at least {summary.rule.thresholds.aMinPFresh} and confidence at least{" "}
            {summary.rule.thresholds.aMinConfidence}; reject below p_fresh {summary.rule.thresholds.rejectBelowPFresh}; review when confidence is below{" "}
            {summary.rule.thresholds.reviewBelowConfidence}.
          </p>
        </CardContent>
      </Card>

      {summary.perFruit.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="fn-heading-sm">By fruit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summary.perFruit.map((f) => (
                <div key={f.fruit} className="space-y-2 rounded-2xl bg-fog p-4" data-testid="fruit-row">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-bold capitalize text-graphite">{fruitLabel(f.fruit)}</p>
                    <p className="text-sm text-muted-foreground">
                      {f.count} photo{f.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white" role="presentation">
                    {GRADES.map((g) => (
                      <div key={g} className={GRADE_META[g].bar} style={{ width: `${f.percentages[g]}%` }} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A {f.counts.A} - B {f.counts.B} - Review {f.counts.REVIEW} - Reject {f.counts.REJECT}
                    {f.meanPFresh !== null ? ` - mean p_fresh ${f.meanPFresh}%` : ""}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <section aria-labelledby="photos-heading" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="photos-heading" className="fn-heading-sm text-graphite">
            Photos
          </h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter photos by grade">
            {(["all", ...GRADES] as const).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={filter === g ? "dark" : "secondary"}
                aria-pressed={filter === g}
                onClick={() => setFilter(g)}
                className="min-h-11"
              >
                {g === "all" ? `All (${photos.length})` : `${GRADE_META[g].label} (${photos.filter((p) => p.grade === g).length})`}
              </Button>
            ))}
          </div>
        </div>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="photo-grid">
          {shown.map((p, i) => (
            <li key={`${p.label}-${i}`} className="flex gap-3 rounded-3xl border border-border bg-white p-3">
              <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-fog">
                {p.thumb ? (
                  <img src={p.thumb} alt={`Photo ${p.label}`} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" aria-label="Photo not stored" />
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusTag tone={GRADE_META[p.grade].tone}>{GRADE_META[p.grade].label}</StatusTag>
                  <span className="text-sm font-bold capitalize text-graphite">{fruitLabel(p.fruit)}</span>
                </div>
                <p className="truncate text-xs text-muted-foreground" title={p.label}>
                  {p.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  p_fresh {p.pFresh !== null ? `${p.pFresh}%` : "n/a"} - confidence {p.confidence !== null ? `${p.confidence}%` : "n/a"}
                </p>
                {p.reasons.map((r) => (
                  <p key={r} className="text-xs leading-snug text-graphite">
                    {r}
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
