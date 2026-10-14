import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Consistent page title block for app screens: optional eyebrow, a 30px bold
 * heading, supporting copy, and a right-aligned (stacked on phones) action slot.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className
      )}
    >
      <div className="min-w-0 space-y-2">
        {eyebrow && <p className="fn-eyebrow">{eyebrow}</p>}
        <h1 className="fn-heading text-graphite">{title}</h1>
        {description && (
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
    </header>
  );
}
