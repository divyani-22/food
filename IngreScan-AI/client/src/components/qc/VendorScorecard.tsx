import { StatusTag, type Tone } from "@/components/brand/StatusTag";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Download, Loader2, Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "./States";
import { VERDICT_META, triggerDownload, type Verdict } from "./types";

const TREND: Record<string, { label: string; tone: Tone }> = {
  improving: { label: "Improving", tone: "positive" },
  declining: { label: "Declining", tone: "negative" },
  stable: { label: "Stable", tone: "info" },
  insufficient_data: { label: "Not enough data", tone: "neutral" },
};

export function VendorScorecard({ onStart }: { onStart: () => void }) {
  const utils = trpc.useUtils();
  const card = trpc.qc.scorecard.useQuery();
  const [busy, setBusy] = useState(false);

  if (card.isLoading) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading scorecard
      </div>
    );
  }
  if (card.error) return <ErrorState message={card.error.message} onRetry={() => card.refetch()} />;
  const data = card.data;
  if (!data || data.vendors.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="No vendors scored yet"
        description="Vendors are ranked after you grade at least one batch. Rejection rate and trend are pooled across all stored batches."
        actionLabel="Grade a batch"
        onAction={onStart}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">{data.rankingRule}</p>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const f = await utils.qc.csv.fetch({}, { staleTime: 0 });
              triggerDownload(f.filename, f.csv);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not download the scorecard");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download scorecard CSV
        </Button>
      </div>
      {data.warnings.map((w) => (
        <p key={w} className="rounded-2xl bg-fog p-3 text-sm text-graphite" role="note">
          {w}
        </p>
      ))}

      <div className="hidden overflow-x-auto rounded-3xl border border-border bg-white p-2 md:block">
        <Table data-testid="scorecard-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Rank</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Batches</TableHead>
              <TableHead className="text-right">Photos</TableHead>
              <TableHead className="text-right">Pooled A share</TableHead>
              <TableHead className="text-right">Rejection rate</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Last verdict</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.vendors.map((v) => (
              <TableRow key={v.vendor} data-testid="scorecard-row">
                <TableCell className="fn-metric text-base">{v.rank}</TableCell>
                <TableCell className="font-bold">{v.vendor}</TableCell>
                <TableCell className="text-right tabular-nums">{v.batches}</TableCell>
                <TableCell className="text-right tabular-nums">{v.totalPhotos}</TableCell>
                <TableCell className="text-right tabular-nums">{v.pooledAPct}%</TableCell>
                <TableCell className="text-right tabular-nums">{v.rejectionRate}%</TableCell>
                <TableCell>
                  <StatusTag tone={(TREND[v.trend] ?? TREND.insufficient_data).tone} onWhite>
                    {(TREND[v.trend] ?? TREND.insufficient_data).label}
                    {v.trendDeltaPts !== null ? ` (${v.trendDeltaPts > 0 ? "+" : ""}${v.trendDeltaPts} pts)` : ""}
                  </StatusTag>
                </TableCell>
                <TableCell>{v.lastVerdict ? VERDICT_META[v.lastVerdict as Verdict]?.label ?? v.lastVerdict : "n/a"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {data.vendors.map((v) => (
          <li key={v.vendor} className="space-y-3 rounded-3xl border border-border bg-white p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-fog fn-metric text-base">{v.rank}</span>
              <p className="min-w-0 flex-1 truncate font-bold text-graphite">{v.vendor}</p>
              <StatusTag tone={(TREND[v.trend] ?? TREND.insufficient_data).tone}>{(TREND[v.trend] ?? TREND.insufficient_data).label}</StatusTag>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-2xl bg-fog p-3">
                <dt className="text-xs font-bold text-muted-foreground">Pooled A share</dt>
                <dd className="fn-metric mt-1 text-xl">{v.pooledAPct}%</dd>
              </div>
              <div className="rounded-2xl bg-fog p-3">
                <dt className="text-xs font-bold text-muted-foreground">Rejection rate</dt>
                <dd className="fn-metric mt-1 text-xl">{v.rejectionRate}%</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {v.batches} batch{v.batches === 1 ? "" : "es"} - {v.totalPhotos} photos
              {v.lastVerdict ? ` - last: ${VERDICT_META[v.lastVerdict as Verdict]?.label ?? v.lastVerdict}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
