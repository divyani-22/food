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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Download, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorState } from "./States";
import { VERDICT_META, triggerDownload, type QcListItem, type Verdict } from "./types";

export function BatchHistory({ onOpen, onStart }: { onOpen: (id: number) => Promise<void> | void; onStart: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.qc.list.useQuery();
  const [pendingDelete, setPendingDelete] = useState<QcListItem | null>(null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [csvId, setCsvId] = useState<number | null>(null);
  const del = trpc.qc.delete.useMutation({
    onSuccess: async () => {
      toast.success("Batch deleted");
      setPendingDelete(null);
      await Promise.all([utils.qc.list.invalidate(), utils.qc.scorecard.invalidate()]);
    },
    onError: (e) => {
      toast.error(e.message);
      setPendingDelete(null);
    },
  });

  if (list.isLoading) {
    return (
      <div className="flex items-center gap-3 py-10 text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading batches
      </div>
    );
  }
  if (list.error) return <ErrorState message={list.error.message} onRetry={() => list.refetch()} />;
  if (!list.data || list.data.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No graded batches yet"
        description="Grade your first batch of crate photos and it will be saved here for audit, CSV export and vendor scoring."
        actionLabel="Grade a batch"
        onAction={onStart}
      />
    );
  }

  return (
    <>
      <ul className="space-y-3" data-testid="history-list">
        {list.data.map((b) => {
          const v = VERDICT_META[b.verdict as Verdict];
          return (
            <li key={b.id} className="rounded-3xl border border-border bg-white p-4 sm:p-5" data-testid="history-row">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-base font-bold text-graphite">{b.vendor}</p>
                    {b.lotId ? <span className="text-sm text-muted-foreground">lot {b.lotId}</span> : null}
                    <StatusTag tone={v?.tone ?? "neutral"}>{v?.label ?? b.verdict}</StatusTag>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(b.createdAt).toLocaleString()} - {b.total} photo{b.total === 1 ? "" : "s"} - A {b.counts.A}, B {b.counts.B}, Review{" "}
                    {b.counts.REVIEW}, Reject {b.counts.REJECT} - mean p_fresh {Math.round(b.meanPFresh * 10) / 10}%
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={openingId === b.id}
                    onClick={async () => {
                      setOpeningId(b.id);
                      try {
                        await onOpen(b.id);
                      } finally {
                        setOpeningId(null);
                      }
                    }}
                  >
                    {openingId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                    Open
                  </Button>
                  <Button
                    variant="outline"
                    disabled={csvId === b.id}
                    onClick={async () => {
                      setCsvId(b.id);
                      try {
                        const f = await utils.qc.csv.fetch({ id: b.id }, { staleTime: 0 });
                        triggerDownload(f.filename, f.csv);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not download the CSV");
                      } finally {
                        setCsvId(null);
                      }
                    }}
                  >
                    {csvId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download CSV
                  </Button>
                  <Button variant="outline" size="icon" aria-label={`Delete batch ${b.vendor} ${b.lotId ?? b.id}`} onClick={() => setPendingDelete(b)} className="h-11 w-11">
                    <Trash2 className="h-4 w-4 text-signal-red-orange" />
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && !del.isPending && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this batch?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `${pendingDelete.vendor}${pendingDelete.lotId ? `, lot ${pendingDelete.lotId}` : ""} with ${pendingDelete.total} graded photos` : ""} will be removed
              permanently and vendor scores will be recalculated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) del.mutate({ id: pendingDelete.id });
              }}
            >
              {del.isPending ? "Deleting" : "Delete batch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
