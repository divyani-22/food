import { StatusTag, type Tone } from "@/components/brand/StatusTag";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";
import { memo } from "react";

export const UNITS = ["pcs", "kg", "g", "lb", "oz", "l", "ml", "pack", "dozen"] as const;
export const LOCATIONS = ["fridge", "freezer", "pantry"] as const;
export const CATEGORIES = [
  { value: "Dairy", label: "Dairy & Eggs" },
  { value: "Produce", label: "Fruits & Vegetables" },
  { value: "Meat", label: "Meat & Seafood" },
  { value: "Grains", label: "Bakery & Grains" },
  { value: "Snacks", label: "Snacks & Packaged" },
  { value: "Beverages", label: "Beverages" },
  { value: "Condiments", label: "Sauces & Condiments" },
  { value: "Other", label: "Other" },
] as const;

export interface ReviewRow {
  key: string;
  include: boolean;
  name: string;
  quantity: string;
  unit: string;
  location: string;
  category: string;
  expiry: string;
  confidence: "high" | "medium" | "low" | "none";
  note?: string;
  rawLine: string;
  hadSuggestion: boolean;
  price?: number;
  packSize?: string;
  /** Parser confidence that this is a correctly read food line. "low" rows start unticked. */
  lineConfidence?: "high" | "medium" | "low";
  lineReasons?: string[];
}

export interface RowErrors {
  name?: string;
  quantity?: string;
  expiry?: string;
}

const CONF: Record<ReviewRow["confidence"], { label: string; tone: Tone }> = {
  high: { label: "High confidence", tone: "positive" },
  medium: { label: "Medium confidence", tone: "info" },
  low: { label: "Low confidence", tone: "caution" },
  none: { label: "No estimate", tone: "neutral" },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Validates one row for import; returns undefined entries for valid fields. */
export function validateRow(r: ReviewRow): RowErrors {
  const e: RowErrors = {};
  if (!r.name.trim()) e.name = "Name is required";
  const q = Number(r.quantity);
  if (r.quantity.trim() === "" || !Number.isFinite(q) || q <= 0) e.quantity = "Enter a quantity above 0";
  else if (q > 100000) e.quantity = "Quantity is too large";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiry)) e.expiry = "Choose an expiry date";
  else {
    const d = new Date(`${r.expiry}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== r.expiry) e.expiry = "Not a real calendar date";
  }
  return e;
}

export const ReceiptRow = memo(function ReceiptRow({
  row,
  errors,
  onChange,
}: {
  row: ReviewRow;
  errors?: RowErrors;
  onChange: (key: string, patch: Partial<ReviewRow>) => void;
}) {
  const id = `rr-${row.key}`;
  const needsDate = row.include && !row.expiry;
  const conf = CONF[row.confidence];
  const lbl = "text-xs font-bold text-muted-foreground md:sr-only";
  return (
    <li
      data-testid="receipt-row"
      data-included={row.include}
      className={cn(
        "rounded-3xl border bg-white p-4 md:rounded-2xl md:p-3",
        needsDate || errors?.expiry ? "border-sunset-orange" : "border-border",
        !row.include && "opacity-60"
      )}
    >
      <div className="grid gap-3 md:grid-cols-[2.75rem_minmax(0,2.4fr)_5.5rem_6.5rem_7.5rem_12rem_10rem] md:items-start">
        <div className="flex items-center justify-between md:block">
          <label htmlFor={`${id}-inc`} className="flex min-h-11 min-w-11 cursor-pointer items-center gap-2 md:justify-center">
            <Checkbox id={`${id}-inc`} checked={row.include} onCheckedChange={(v) => onChange(row.key, { include: v === true })} aria-label={`Include ${row.name || "item"}`} />
            <span className="text-sm font-bold text-graphite md:sr-only">Include</span>
          </label>
          <div className="md:hidden">
            <StatusTag tone={conf.tone}>{conf.label}</StatusTag>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-name`} className={lbl}>Name</Label>
          <Input id={`${id}-name`} value={row.name} maxLength={255} aria-invalid={!!errors?.name} onChange={(e) => onChange(row.key, { name: e.target.value })} />
          {errors?.name && <p className="text-xs font-medium text-signal-red-orange">{errors.name}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-qty`} className={lbl}>Qty</Label>
          <Input id={`${id}-qty`} inputMode="decimal" value={row.quantity} aria-invalid={!!errors?.quantity} onChange={(e) => onChange(row.key, { quantity: e.target.value })} />
          {errors?.quantity && <p className="text-xs font-medium text-signal-red-orange">{errors.quantity}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-unit`} className={lbl}>Unit</Label>
          <Select value={row.unit} onValueChange={(v) => onChange(row.key, { unit: v })}>
            <SelectTrigger id={`${id}-unit`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-loc`} className={lbl}>Store in</Label>
          <Select value={row.location} onValueChange={(v) => onChange(row.key, { location: v })}>
            <SelectTrigger id={`${id}-loc`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LOCATIONS.map((l) => <SelectItem key={l} value={l}>{cap(l)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-cat`} className={lbl}>Category</Label>
          <Select value={row.category} onValueChange={(v) => onChange(row.key, { category: v })}>
            <SelectTrigger id={`${id}-cat`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${id}-exp`} className={lbl}>Expiry date</Label>
          <Input id={`${id}-exp`} type="date" value={row.expiry} aria-invalid={needsDate || !!errors?.expiry} onChange={(e) => onChange(row.key, { expiry: e.target.value })} />
          {(errors?.expiry || needsDate) && <p className="text-xs font-medium text-graphite">{errors?.expiry ?? "No estimate for this item. Choose an expiry date."}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0 md:pl-[2.75rem]">
        <span className="hidden md:inline-flex">
          <StatusTag tone={conf.tone}>{conf.label}</StatusTag>
        </span>
        {row.lineConfidence && row.lineConfidence !== "high" ? (
          <span className="inline-flex items-center gap-1.5" data-testid="line-doubt" data-level={row.lineConfidence}>
            <TriangleAlert className="h-3.5 w-3.5 text-sunset-orange" aria-hidden="true" />
            <span className="text-xs font-bold text-graphite">
              {row.lineConfidence === "low" ? "Doubtful line" : "Check this line"}
              {row.lineReasons?.length ? `: ${row.lineReasons.join("; ")}` : ""}
            </span>
          </span>
        ) : null}
        {row.note ? <span className="text-xs text-muted-foreground">{row.note}</span> : null}
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={row.rawLine}>
          Receipt line: {row.rawLine}
          {row.packSize ? ` (pack ${row.packSize})` : ""}
        </span>
      </div>
    </li>
  );
});

export function ReceiptHeader() {
  return (
    <div className="hidden grid-cols-[2.75rem_minmax(0,2.4fr)_5.5rem_6.5rem_7.5rem_12rem_10rem] gap-3 px-3 text-xs font-bold text-muted-foreground md:grid" aria-hidden="true">
      <span>Add</span>
      <span>Name</span>
      <span>Qty</span>
      <span>Unit</span>
      <span>Store in</span>
      <span>Category</span>
      <span>Expiry date</span>
    </div>
  );
}
