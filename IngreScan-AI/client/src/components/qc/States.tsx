import { Button } from "@/components/ui/button";
import { AlertTriangle, type LucideIcon } from "lucide-react";

/** Keyboard-accessible empty state: the action is a real button reachable by Tab. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-border bg-white px-6 py-12 text-center" data-testid="empty-state">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-fog">
        <Icon className="h-6 w-6 text-ember-orange" aria-hidden="true" />
      </div>
      <h3 className="fn-heading-sm mt-4 text-graphite">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <Button className="mt-6" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-white p-5 sm:flex-row sm:items-center" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0 text-signal-red-orange" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm font-medium text-graphite">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
