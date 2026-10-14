import { APP_TITLE } from "@/const";
import { cn } from "@/lib/utils";
import { ScanLine } from "lucide-react";

/**
 * Brand lockup (Foodnoms "Brand Wordmark" pattern): an Ember Orange rounded
 * square holding a white glyph, with the bold wordmark beside it.
 */
export function BrandMark({
  className,
  showWordmark = true,
  size = "md",
}: {
  className?: string;
  showWordmark?: boolean;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-8 w-8 rounded-[10px]" : "h-9 w-9 rounded-xl";
  return (
    <span className={cn("inline-flex items-center gap-2.5 min-w-0", className)}>
      <span
        className={cn("grid shrink-0 place-items-center bg-ember-orange text-white", box)}
        aria-hidden="true"
      >
        <ScanLine className={size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]"} strokeWidth={2.5} />
      </span>
      {showWordmark && (
        <span className="truncate text-lg font-extrabold tracking-tight text-graphite">{APP_TITLE}</span>
      )}
    </span>
  );
}
