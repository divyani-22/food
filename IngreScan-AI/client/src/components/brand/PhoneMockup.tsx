import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Apple, Barcode, Carrot, Milk, Refrigerator, ScanLine, Sparkles } from "lucide-react";

/**
 * Code-native device frame (Foodnoms "Phone Mockup Carousel" role): the product's
 * own UI is the hero imagery. Graphite frame, flat, no shadow.
 */
export function PhoneMockup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("w-[200px] shrink-0 rounded-[40px] bg-graphite p-[9px] sm:w-[240px] lg:w-[260px]", className)}
      aria-hidden="true"
    >
      <div className="relative flex aspect-[9/19] flex-col overflow-hidden rounded-[32px] bg-white">
        <div className="flex items-center justify-between px-5 pt-2.5 text-[10px] font-bold text-graphite">
          <span>9:41</span>
          <span className="h-[18px] w-[64px] rounded-full bg-graphite" />
          <span className="flex gap-0.5">
            <span className="h-2 w-1 rounded-sm bg-graphite" />
            <span className="h-2 w-1 rounded-sm bg-graphite" />
            <span className="h-2 w-3.5 rounded-sm bg-graphite" />
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3.5 pb-3 pt-3 text-graphite">{children}</div>
      </div>
    </div>
  );
}

/** Circular progress ring (Foodnoms "Macro Category Ring"). */
export function Ring({
  value,
  color,
  size = 96,
  stroke = 9,
  children,
}: {
  value: number;
  color: string;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fn-fog)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

function ScreenTitle({ icon: Icon, label }: { icon: typeof ScanLine; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-lg bg-ember-orange text-white">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <span className="text-[13px] font-extrabold">{label}</span>
    </div>
  );
}

function Row({ name, meta, dot, value }: { name: string; meta: string; dot: string; value?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-fog py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-bold leading-tight">{name}</p>
        <p className="truncate text-[9.5px] font-semibold text-muted-foreground">{meta}</p>
      </div>
      <span className="ml-2 flex shrink-0 items-center gap-1 text-[10px] font-bold">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
        {value}
      </span>
    </div>
  );
}

/** Sample packaged-food analysis screen. */
export function ScanResultScreen() {
  return (
    <>
      <ScreenTitle icon={ScanLine} label="Scan result" />
      <div className="rounded-2xl bg-fog p-3">
        <p className="text-[10px] font-bold text-muted-foreground">Instant masala noodles</p>
        <div className="mt-2 flex items-center gap-3">
          <Ring value={68} color="var(--fn-signal-red-orange)" size={64} stroke={7}>
            <span className="fn-metric text-[18px]">68</span>
          </Ring>
          <div>
            <p className="text-[12px] font-extrabold leading-tight">High risk</p>
            <p className="text-[9.5px] font-semibold text-muted-foreground">for your profile</p>
          </div>
        </div>
      </div>
      <p className="mb-1 mt-3 text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">Ingredients</p>
      <Row name="Palm oil" meta="Saturated fat" dot="var(--fn-signal-red-orange)" value="High" />
      <Row name="Refined wheat flour" meta="Refined carb" dot="var(--fn-sunset-orange)" value="Moderate" />
      <Row name="Iodised salt" meta="Sodium" dot="var(--fn-sunset-orange)" value="Moderate" />
      <Row name="Turmeric" meta="Spice" dot="var(--fn-verdant-green)" value="Safe" />
    </>
  );
}

/** Sample fresh-produce freshness screen (uses a real sample photo). */
export function ProduceScreen({ image = "/static/samples/apple.jpg" }: { image?: string }) {
  return (
    <>
      <ScreenTitle icon={Sparkles} label="Fresh Produce AI" />
      <div className="relative overflow-hidden rounded-2xl bg-fog">
        <img src={image} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
        <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-[9.5px] font-extrabold">
          Apple
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Ring value={92} color="var(--fn-verdant-green)" size={60} stroke={7}>
          <span className="fn-metric text-[15px]">92%</span>
        </Ring>
        <div>
          <p className="text-[12px] font-extrabold leading-tight">Fresh</p>
          <p className="text-[9.5px] font-semibold text-muted-foreground">Best within 6 days</p>
        </div>
      </div>
      <div className="mt-3 rounded-2xl bg-fog p-2.5 text-[9.5px] font-semibold leading-snug text-muted-foreground">
        Store unwashed in the crisper drawer, away from bananas.
      </div>
    </>
  );
}

/** Sample expiry-tracker screen. */
export function FridgeScreen() {
  const items = [
    { icon: Milk, name: "Toned milk", meta: "Fridge · 1 L", dot: "var(--fn-sunset-orange)", value: "Today" },
    { icon: Carrot, name: "Carrots", meta: "Fridge · 500 g", dot: "var(--fn-sunset-orange)", value: "2 days" },
    { icon: Apple, name: "Apples", meta: "Pantry · 6", dot: "var(--fn-verdant-green)", value: "6 days" },
    { icon: Milk, name: "Paneer", meta: "Fridge · 200 g", dot: "var(--fn-signal-red-orange)", value: "Expired" },
  ];
  return (
    <>
      <ScreenTitle icon={Refrigerator} label="Expiry Tracker" />
      <div className="mb-3 grid grid-cols-3 gap-1.5 text-center">
        {[
          ["8", "Fresh", "var(--fn-verdant-green)"],
          ["2", "Soon", "var(--fn-sunset-orange)"],
          ["1", "Expired", "var(--fn-signal-red-orange)"],
        ].map(([n, l, c]) => (
          <div key={l} className="rounded-xl bg-fog py-2">
            <p className="fn-metric text-[17px]" style={{ color: c }}>{n}</p>
            <p className="text-[9px] font-bold text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      {items.map(({ icon: Icon, ...it }) => (
        <div key={it.name} className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-fog">
            <Icon className="h-3.5 w-3.5 text-graphite" />
          </span>
          <div className="min-w-0 flex-1">
            <Row {...it} />
          </div>
        </div>
      ))}
    </>
  );
}

/** Sample Open Food Facts product screen. */
export function ProductScreen() {
  const grades = [
    ["A", "var(--fn-verdant-green)"],
    ["B", "var(--fn-sky-blue)"],
    ["C", "var(--fn-sunset-orange)"],
    ["D", "var(--fn-ember-orange)"],
    ["E", "var(--fn-signal-red-orange)"],
  ];
  return (
    <>
      <ScreenTitle icon={Barcode} label="Open Food Facts" />
      <div className="rounded-2xl bg-fog p-3">
        <p className="text-[12px] font-extrabold leading-tight">Digestive biscuits</p>
        <p className="text-[9.5px] font-semibold text-muted-foreground">8901063 · 250 g</p>
        <p className="mt-2.5 text-[9.5px] font-bold text-muted-foreground">Nutri-Score</p>
        <div className="mt-1 flex gap-1">
          {grades.map(([g, c]) => (
            <span
              key={g}
              className={cn(
                "grid h-6 flex-1 place-items-center rounded-md text-[10px] font-extrabold text-white",
                g === "D" ? "scale-110" : "opacity-35"
              )}
              style={{ background: c }}
            >
              {g}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <div className="rounded-xl bg-fog p-2">
          <p className="text-[9px] font-bold text-muted-foreground">NOVA</p>
          <p className="fn-metric text-[17px] text-signal-red-orange">4</p>
        </div>
        <div className="rounded-xl bg-fog p-2">
          <p className="text-[9px] font-bold text-muted-foreground">Energy</p>
          <p className="fn-metric text-[17px]">482<span className="text-[9px]"> kcal</span></p>
        </div>
      </div>
      <Row name="Sugars" meta="per 100 g" dot="var(--fn-signal-red-orange)" value="21 g" />
      <Row name="Fibre" meta="per 100 g" dot="var(--fn-verdant-green)" value="3.6 g" />
    </>
  );
}
