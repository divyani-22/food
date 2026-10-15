import { useEffect, useState } from "react";
import { ExternalLink, MapPin, RefreshCw, Store, Tag } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusTag } from "@/components/brand/StatusTag";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";

type Market = inferRouterOutputs<AppRouter>["analysis"]["alternativeMarket"];
export type MarketItem = Market["items"][number];

/** True once the element has been on screen (or immediately when IntersectionObserver is unavailable). */
export function useSeenOnce(el: Element | null): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [el, seen]);
  return seen;
}

/** One lazy query per scan (only when alternatives exist and the list has been scrolled near). */
export function useAlternativeMarket(scanId: number, enabled: boolean) {
  return trpc.analysis.alternativeMarket.useQuery(
    { scanId },
    { enabled: enabled && scanId > 0, retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false },
  );
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

const PER_LABEL: Record<string, string> = { kilogram: "per kg", unit: "per unit", litre: "per litre", liter: "per litre" };

/** Compact "Where to find it" block for one alternative. Never shows anything that was not reported by the sources. */
export function WhereToFindIt({
  item,
  loading,
  failed,
  onRetry,
  retrying,
  attribution,
}: {
  item?: MarketItem;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  retrying: boolean;
  attribution?: string;
}) {
  const shell = "space-y-2 rounded-xl bg-white p-3 text-sm md:p-4";
  const heading = (
    <p className="flex items-center gap-1.5 font-bold text-graphite">
      <MapPin className="h-4 w-4 text-ember-orange" aria-hidden="true" />
      Where to find it
    </p>
  );

  if (loading) {
    return (
      <div className={shell} data-testid="market-loading" aria-busy="true" aria-label="Looking up community price data">
        {heading}
        <Skeleton className="h-4 w-2/3 rounded-lg" />
        <Skeleton className="h-6 w-full rounded-3xl" />
      </div>
    );
  }

  if (failed || !item || item.status === "unavailable") {
    return (
      <div className={shell} data-testid="market-error">
        {heading}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-muted-foreground">Price data is unavailable right now.</p>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-3xl px-2 text-xs font-bold text-graphite underline underline-offset-2 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} aria-hidden="true" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (item.status === "no_match" || !item.match) {
    return (
      <div className={shell} data-testid="market-none">
        {heading}
        <p className="text-muted-foreground">No community data found</p>
      </div>
    );
  }

  const { match, price, availability } = item;
  const stores = availability.stores.slice(0, 5);
  const extraStores = availability.stores.length - stores.length;

  return (
    <div className={shell} data-testid="market-ok">
      {heading}
      <p className="break-words text-xs text-muted-foreground">
        Matched to <span className="font-bold text-graphite">{match.name}</span>
        {match.brand ? ` (${match.brand.split(",")[0]})` : ""} on Open Food Facts
      </p>

      {price ? (
        <div className="space-y-1" data-testid="market-price">
          <p className="flex flex-wrap items-center gap-2 text-graphite">
            <Tag className="h-4 w-4 shrink-0 text-verdant-green" aria-hidden="true" />
            <span className="font-bold">
              {formatMoney(price.amount, price.currency)}
              {price.pricePer && PER_LABEL[price.pricePer] ? ` ${PER_LABEL[price.pricePer]}` : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              reported {price.date}
              {price.locationName ? ` at ${price.locationName}` : ""}
            </span>
            {price.stale && <StatusTag tone="caution" onWhite>Old price (over 12 months)</StatusTag>}
          </p>
          {price.count > 1 && (
            <p className="text-xs text-muted-foreground">
              {price.count} recent reports: {formatMoney(price.min, price.currency)} to {formatMoney(price.max, price.currency)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Community-reported, may be outdated</p>
        </div>
      ) : (
        <p className="text-muted-foreground" data-testid="market-no-price">
          {item.priceStatus === "unavailable" ? "Price data is unavailable right now." : "No community prices found"}
        </p>
      )}

      {stores.length > 0 && (
        <div className="space-y-1.5" data-testid="market-stores">
          <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
            <Store className="h-3.5 w-3.5" aria-hidden="true" />
            Reported at
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {stores.map((s) => (
              <li key={s} className="max-w-full break-words rounded-3xl bg-fog px-2.5 py-1 text-xs font-bold text-graphite">
                {s}
              </li>
            ))}
            {extraStores > 0 && <li className="rounded-3xl bg-fog px-2.5 py-1 text-xs text-muted-foreground">+{extraStores} more</li>}
          </ul>
        </div>
      )}
      {availability.countries.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">Sold in: {availability.countries.slice(0, 6).join(", ")}</p>
      )}

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <a href={match.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-graphite underline underline-offset-2">
          Open Food Facts <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        {price && (
          <a href={price.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold text-graphite underline underline-offset-2">
            Open Prices <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
      </p>
      {attribution && <p className="text-[11px] leading-snug text-muted-foreground">{attribution}</p>}
    </div>
  );
}
