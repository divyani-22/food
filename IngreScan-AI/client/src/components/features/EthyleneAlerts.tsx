import { StatusTag } from "@/components/brand/StatusTag";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Leaf } from "lucide-react";

/** Storage alerts for produce that should not share a drawer (ethylene producers next to sensitive items). */
export function EthyleneAlerts({ className = "" }: { className?: string }) {
  const { data, isLoading, error } = trpc.insights.ethyleneAlerts.useQuery();

  return (
    <section className={`space-y-4 rounded-3xl bg-white p-5 md:p-7 ${className}`} aria-label="Storage alerts">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
          <Leaf className="h-5 w-5 text-verdant-green" />
        </span>
        <div className="min-w-0">
          <h2 className="fn-heading-sm text-graphite">Storage alerts</h2>
          <p className="text-sm text-muted-foreground">Some produce ripens or spoils its neighbours faster. Keep these apart.</p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-16 w-full rounded-2xl" />}
      {error && <p role="alert" className="text-sm text-signal-red-orange">{error.message}</p>}

      {data && data.alerts.length === 0 && (
        <p className="rounded-2xl bg-fog p-4 text-sm font-medium text-graphite">
          {data.itemCount === 0
            ? "Add produce to your pantry to get storage tips. Nothing to separate yet."
            : "Nothing to separate right now. Your items are fine to store together."}
        </p>
      )}

      {data && data.alerts.length > 0 && (
        <ul className="space-y-3">
          {data.alerts.map((a) => (
            <li key={a.id} className="space-y-2 rounded-2xl bg-fog p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusTag tone={a.severity === "warning" ? "caution" : "info"} onWhite>
                  {a.severity === "warning" ? "Warning" : "Tip"}
                </StatusTag>
                <StatusTag tone="neutral" onWhite className="capitalize">{a.storageLocation}</StatusTag>
              </div>
              <p className="break-words font-bold text-graphite">{a.title}</p>
              <p className="break-words text-sm text-muted-foreground">{a.advice}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
