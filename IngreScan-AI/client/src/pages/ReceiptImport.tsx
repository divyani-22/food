import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/brand/PageHeader";
import { StatusTag } from "@/components/brand/StatusTag";
import { ReceiptHeader, ReceiptRow, parseQuantity, validateRow, type ReviewRow, type RowErrors } from "@/components/receipt/ReceiptReview";
import { EmptyState } from "@/components/qc/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ImagePlus, Loader2, Mail, ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

type Parsed = inferRouterOutputs<AppRouter>["receipt"]["parse"];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EBILL_BYTES = 1024 * 1024;
const EBILL_EXT = /\.(eml|html?|txt)$/i;
const SKIP_LABEL: Record<string, string> = {
  total: "Total line",
  tax: "Tax",
  discount: "Discount",
  fee: "Fee or charge",
  payment: "Payment details",
  address: "Address",
  phone: "Phone number",
  order_id: "Order or invoice id",
  date: "Date or time",
  header: "Header or footer",
  non_food: "Not a food item",
  no_price: "No price found",
  unparseable: "Could not read",
};

let rowSeq = 0;

function toRows(parsed: Parsed): ReviewRow[] {
  return parsed.items.map((it) => ({
    key: `r${++rowSeq}`,
    include: it.lineConfidence !== "low",
    name: it.name,
    quantity: String(it.quantity),
    unit: it.unit,
    location: it.suggestedLocation,
    category: it.category,
    expiry: it.suggestedExpiryDate ?? "",
    confidence: it.shelfLifeConfidence,
    note: it.note,
    rawLine: it.rawLine,
    hadSuggestion: !!it.suggestedExpiryDate,
    price: it.price,
    packSize: it.packSize,
    lineConfidence: it.lineConfidence,
    lineReasons: it.lineConfidenceReasons,
  }));
}

function formatOrderDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function ReceiptImport() {
  const [text, setText] = useState("");
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [ebill, setEbill] = useState<{ content: string; name: string } | null>(null);
  const [ebillError, setEbillError] = useState<string | null>(null);
  const ebillRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [parseError, setParseError] = useState<{ message: string; needsText: boolean } | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const utils = trpc.useUtils();

  const parse = trpc.receipt.parse.useMutation({
    onSuccess: (res) => {
      setParsed(res);
      setRows(toRows(res));
      setErrors({});
      setParseError(null);
      setImportedCount(null);
    },
    onError: (err) => {
      setParsed(null);
      setRows([]);
      setParseError({ message: err.message, needsText: err.data?.code === "PRECONDITION_FAILED" });
    },
  });

  const importItems = trpc.receipt.importItems.useMutation({
    onSuccess: async (res) => {
      setImportedCount(res.imported);
      setImportError(null);
      await utils.invalidate();
      toast.success(`${res.imported} item${res.imported === 1 ? "" : "s"} added to your pantry`);
    },
    onError: (err) => setImportError(err.message),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.error("Use a JPEG, PNG or WebP photo of the receipt.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("That photo is larger than 8 MB. Use a smaller photo or paste the receipt text.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: reader.result as string, name: file.name });
    reader.onerror = () => toast.error("Could not read that photo");
    reader.readAsDataURL(file);
  };

  const onEbillFile = (file: File | undefined) => {
    if (!file) return;
    setEbillError(null);
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      setEbillError("PDF e-bills are not supported. Open the PDF, select and copy its text, and paste it into the box above.");
      return;
    }
    if (!EBILL_EXT.test(file.name)) {
      setEbillError("Use an .eml, .html, .htm or .txt file, or paste the bill text.");
      return;
    }
    if (file.size > MAX_EBILL_BYTES) {
      setEbillError("That file is larger than 1 MB. Paste only the order items section instead.");
      return;
    }
    if (file.size === 0) {
      setEbillError("That file is empty.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEbill({ content: String(reader.result ?? ""), name: file.name });
    reader.onerror = () => setEbillError("Could not read that file.");
    reader.readAsText(file);
  };

  const readReceipt = () => {
    setParseError(null);
    if (ebill) parse.mutate({ ebill: { content: ebill.content, filename: ebill.name } });
    else if (text.trim()) parse.mutate({ text });
    else if (image) parse.mutate({ imageDataUrl: image.dataUrl });
  };

  const change = useCallback((key: string, patch: Partial<ReviewRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const included = rows.filter((r) => r.include);
  const missingDates = included.filter((r) => !r.expiry).length;

  const doImport = () => {
    setImportError(null);
    const found: Record<string, RowErrors> = {};
    for (const r of included) {
      const e = validateRow(r);
      if (Object.keys(e).length) found[r.key] = e;
    }
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error("Fix the highlighted rows before importing.");
      return;
    }
    importItems.mutate({
      items: included.map((r) => ({
        name: r.name.trim(),
        quantity: parseQuantity(r.quantity),
        unit: r.unit,
        category: r.category,
        storageLocation: r.location as "fridge" | "freezer" | "pantry",
        expiryDate: r.expiry,
      })),
    });
  };

  const reset = () => {
    setText("");
    setImage(null);
    setEbill(null);
    setEbillError(null);
    setParsed(null);
    setRows([]);
    setErrors({});
    setParseError(null);
    setImportedCount(null);
    setImportError(null);
  };

  const canRead = (text.trim().length > 0 || !!image || !!ebill) && !parse.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Track"
          title="Receipt import"
          description="Paste a grocery receipt or e-bill, or upload an order email (.eml or .html), and add what you bought to your pantry with estimated expiry dates you can edit before saving."
        />

        {importedCount !== null ? (
          <div className="flex flex-col items-center rounded-3xl border border-border bg-white px-6 py-12 text-center" data-testid="import-success">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-fog">
              <CheckCircle2 className="h-6 w-6 text-verdant-green" aria-hidden="true" />
            </div>
            <h2 className="fn-heading-sm mt-4 text-graphite">
              {importedCount} item{importedCount === 1 ? "" : "s"} added to your pantry
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">They are now in your Expiry Tracker with the dates you confirmed.</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/fridge">Open Expiry Tracker</Link>
              </Button>
              <Button variant="outline" size="lg" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
                Import another receipt
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Card>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="receipt-text">Receipt or e-bill text</Label>
                  <Textarea
                    id="receipt-text"
                    ref={textRef}
                    value={text}
                    maxLength={60000}
                    onChange={(e) => setText(e.target.value)}
                    rows={10}
                    className="font-mono text-sm"
                    placeholder={"Paste the receipt here, one item per line, for example:\nAmul Taaza Milk 500 ml  x2  56.00\nBananas 1.2 kg  $2.40"}
                  />
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-bold text-graphite">Or upload an e-bill</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" onClick={() => ebillRef.current?.click()}>
                      <Mail className="h-4 w-4" />
                      Upload e-bill file
                    </Button>
                    <input
                      ref={ebillRef}
                      type="file"
                      accept=".eml,.html,.htm,.txt,message/rfc822,text/html,text/plain,application/pdf"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label="Upload e-bill file"
                      data-testid="ebill-file"
                      onChange={(e) => {
                        onEbillFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {ebill && (
                      <span className="flex min-w-0 items-center gap-2 rounded-3xl bg-fog py-1 pl-3 pr-1 text-sm font-medium text-graphite" data-testid="ebill-chip">
                        <span className="truncate">{ebill.name}</span>
                        <button
                          type="button"
                          aria-label="Remove e-bill file"
                          onClick={() => setEbill(null)}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </div>
                  {ebillError && (
                    <div className="flex items-start gap-3 rounded-2xl bg-fog p-3" role="alert" data-testid="ebill-error">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-red-orange" aria-hidden="true" />
                      <p className="text-sm font-medium text-graphite">{ebillError}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Save the order email from Instacart, Blinkit, Zepto, BigBasket, Swiggy Instamart or Amazon Fresh as .eml, or save the page as .html, then upload it (up to 1 MB). PDF files are not supported: copy the text from the PDF and paste it above. Layouts differ and may change, so check every row.
                  </p>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-bold text-graphite">Or use a photo</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                      <ImagePlus className="h-4 w-4" />
                      Upload receipt photo
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      tabIndex={-1}
                      aria-label="Upload receipt photo"
                      data-testid="receipt-photo"
                      onChange={(e) => {
                        onFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {image && (
                      <span className="flex min-w-0 items-center gap-2 rounded-3xl bg-fog py-1 pl-3 pr-1 text-sm font-medium text-graphite">
                        <span className="truncate">{image.name}</span>
                        <button
                          type="button"
                          aria-label="Remove receipt photo"
                          onClick={() => setImage(null)}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Reading a photo needs an AI key on the server; pasted text always works and is parsed locally on the server. Photos up to 8 MB. If several are given the e-bill file is used first, then the text.
                  </p>
                </div>

                {parseError && (
                  <div className="flex items-start gap-3 rounded-2xl bg-fog p-4" role="alert" data-testid="parse-error">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-red-orange" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-graphite">{parseError.message}</p>
                      {parseError.needsText && (
                        <button type="button" className="text-sm font-bold text-graphite underline underline-offset-4" onClick={() => textRef.current?.focus()}>
                          Paste the receipt text instead
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button size="lg" disabled={!canRead} onClick={readReceipt}>
                    {parse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
                    {parse.isPending ? "Reading" : "Read receipt"}
                  </Button>
                  {(text || image || ebill || parsed) && (
                    <Button variant="ghost" size="lg" onClick={reset} disabled={parse.isPending}>
                      Clear
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {!parsed && !parse.isPending && !parseError && (
              <EmptyState
                icon={ReceiptText}
                title="No receipt read yet"
                description="Paste your receipt text above and choose Read receipt. You will review every item, its storage place and expiry date before anything is saved."
                actionLabel="Paste a receipt"
                onAction={() => textRef.current?.focus()}
              />
            )}

            {parsed && (
              <section className="space-y-5" aria-labelledby="review-heading">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="space-y-2">
                    <h2 id="review-heading" className="fn-heading-sm text-graphite">
                      Review items
                    </h2>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusTag tone="info">{parsed.source === "llm" ? "Read by AI" : "Parsed from text"}</StatusTag>
                      {parsed.merchant ? (
                        <span data-testid="merchant-tag">
                          <StatusTag tone="info">{parsed.merchant}</StatusTag>
                        </span>
                      ) : (
                        parsed.store && <StatusTag>{parsed.store}</StatusTag>
                      )}
                      {parsed.orderDate && (
                        <span className="inline-flex items-center gap-1.5" data-testid="order-date">
                          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <StatusTag>
                            Order date {formatOrderDate(parsed.orderDate)}
                            {parsed.orderDateSource === "email" ? " (email date)" : ""}
                          </StatusTag>
                        </span>
                      )}
                      {parsed.currency && <StatusTag>{parsed.currency}</StatusTag>}
                      <span className="text-sm text-muted-foreground">
                        {rows.length} item{rows.length === 1 ? "" : "s"} detected
                      </span>
                    </div>
                  </div>
                </div>

                {parsed.warnings.map((w) => (
                  <div key={w} className="flex items-start gap-3 rounded-2xl bg-white p-4" role="note">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sunset-orange" aria-hidden="true" />
                    <p className="text-sm font-medium text-graphite">{w}</p>
                  </div>
                ))}

                {rows.length === 0 ? (
                  <EmptyState
                    icon={ReceiptText}
                    title="No food items found"
                    description="Nothing on this receipt looked like a food item. Check the skipped lines below, or paste the text again with one item per line."
                    actionLabel="Edit the text"
                    onAction={() => textRef.current?.focus()}
                  />
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Expiry dates are estimates from typical shelf life
                      {parsed.orderDate ? `, counted from the order date (${formatOrderDate(parsed.orderDate)})` : ""}. Check the pack for the printed date and edit any row.
                      {rows.some((r) => !r.include) ? " Doubtful lines start unticked; tick them if they are correct." : ""}
                    </p>
                    <ReceiptHeader />
                    <ul className="space-y-3" data-testid="receipt-rows">
                      {rows.map((r) => (
                        <ReceiptRow key={r.key} row={r} errors={errors[r.key]} onChange={change} />
                      ))}
                    </ul>

                    {importError && (
                      <p className="rounded-2xl bg-white p-3 text-sm font-medium text-signal-red-orange" role="alert">
                        {importError}
                      </p>
                    )}
                    {missingDates > 0 && (
                      <p className="text-sm font-medium text-graphite" role="status">
                        {missingDates} selected item{missingDates === 1 ? " needs" : "s need"} an expiry date before import.
                      </p>
                    )}
                    <div className="sticky bottom-24 z-10 md:static">
                      <Button size="lg" className="w-full sm:w-auto" disabled={included.length === 0 || importItems.isPending} onClick={doImport}>
                        {importItems.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {importItems.isPending ? "Adding" : `Add ${included.length} item${included.length === 1 ? "" : "s"} to my pantry`}
                      </Button>
                    </div>
                  </>
                )}

                {parsed.skipped.length > 0 && (
                  <Collapsible className="rounded-3xl border border-border bg-white">
                    <CollapsibleTrigger className="flex min-h-12 w-full items-center justify-between gap-3 rounded-3xl px-5 text-left text-sm font-bold text-graphite focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-180">
                      <span>
                        {parsed.skipped.length} skipped line{parsed.skipped.length === 1 ? "" : "s"}
                      </span>
                      <ChevronDown className="h-4 w-4 transition-transform" aria-hidden="true" />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="space-y-2 px-5 pb-5" data-testid="skipped-lines">
                        {parsed.skipped.map((s, i) => (
                          <li key={i} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:gap-3">
                            <StatusTag className="w-fit">{SKIP_LABEL[s.reason] ?? s.reason}</StatusTag>
                            <span className="min-w-0 break-words text-muted-foreground">{s.line}</span>
                          </li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
