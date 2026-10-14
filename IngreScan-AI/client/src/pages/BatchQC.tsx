import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/brand/PageHeader";
import { StatusTag } from "@/components/brand/StatusTag";
import { BatchHistory } from "@/components/qc/BatchHistory";
import { BatchResults } from "@/components/qc/BatchResults";
import { EmptyState } from "@/components/qc/States";
import { VendorScorecard } from "@/components/qc/VendorScorecard";
import {
  ACCEPTED_TYPES,
  MAX_PHOTOS,
  MAX_PHOTO_BYTES,
  classifyQueue,
  deviceSupported,
  readEnginePreference,
  writeEnginePreference,
  type Engine,
  type QcPhoto,
} from "@/components/qc/classify";
import type { QcSummary, ResultPhoto, Grade } from "@/components/qc/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ArrowLeft, Camera, Cloud, Cpu, ImagePlus, Loader2, PackageSearch, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Phase = "edit" | "classifying" | "grading" | "result";

interface ShownResult {
  id: number;
  summary: QcSummary;
  photos: ResultPhoto[];
  notes?: string | null;
  failed: Array<{ name: string; error: string }>;
  engines?: string;
}

let photoSeq = 0;

export default function BatchQC() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("grade");
  const [phase, setPhase] = useState<Phase>("edit");
  const [vendor, setVendor] = useState("");
  const [lotId, setLotId] = useState("");
  const [notes, setNotes] = useState("");
  const [sampleSize, setSampleSize] = useState("");
  const [photos, setPhotos] = useState<QcPhoto[]>([]);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<ShownResult | null>(null);
  const [opened, setOpened] = useState<ShownResult | null>(null);

  const canDevice = useMemo(() => deviceSupported(), []);
  const [engine, setEngine] = useState<Engine>(() => (canDevice ? readEnginePreference() : "server"));

  const abortRef = useRef<AbortController | null>(null);
  const photosRef = useRef<QcPhoto[]>([]);
  photosRef.current = photos;
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Free object URLs and stop any run when leaving the page.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    },
    []
  );

  const gradeMutation = trpc.qc.gradeBatch.useMutation();

  const patchPhoto = useCallback((id: string, patch: Partial<QcPhoto>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const files = Array.from(list);
    const accepted: File[] = [];
    let wrongType = 0;
    let tooBig = 0;
    for (const f of files) {
      if (!ACCEPTED_TYPES.includes(f.type)) wrongType++;
      else if (f.size > MAX_PHOTO_BYTES) tooBig++;
      else accepted.push(f);
    }
    const room = MAX_PHOTOS - photosRef.current.length;
    const take = accepted.slice(0, Math.max(0, room));
    const overflow = accepted.length - take.length;
    if (take.length) {
      setPhotos((prev) => [
        ...prev,
        ...take.map((file) => ({ id: `p${++photoSeq}`, file, url: URL.createObjectURL(file), status: "queued" as const })),
      ]);
    }
    if (wrongType) toast.error(`${wrongType} file${wrongType === 1 ? " was" : "s were"} skipped: only JPEG, PNG and WebP photos are accepted.`);
    if (tooBig) toast.error(`${tooBig} photo${tooBig === 1 ? " is" : "s are"} larger than 25 MB and were skipped.`);
    if (overflow > 0) toast.error(`A batch holds at most ${MAX_PHOTOS} photos; ${overflow} were not added.`);
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
  };

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0 };
    photos.forEach((p) => c[p.status]++);
    return c;
  }, [photos]);
  const settled = counts.done + counts.failed;
  const vendorMissing = touched && vendor.trim().length === 0;
  const sampleNum = sampleSize.trim() === "" ? undefined : Number(sampleSize);
  const sampleInvalid = sampleNum !== undefined && (!Number.isInteger(sampleNum) || sampleNum < 1 || sampleNum > 100000);

  const chooseEngine = (e: Engine) => {
    setEngine(e);
    writeEnginePreference(e);
  };

  const reset = () => {
    abortRef.current?.abort();
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
    setResult(null);
    setPhase("edit");
    setCancelled(false);
    setNotice(null);
    setGradeError(null);
    setTouched(false);
    setVendor("");
    setLotId("");
    setNotes("");
    setSampleSize("");
  };

  const submitGrade = async (current: QcPhoto[]) => {
    const usable = current.filter((p) => p.status === "done" && p.result);
    if (usable.length === 0) {
      setPhase("edit");
      setGradeError("No photo could be classified, so there is nothing to grade.");
      return;
    }
    setPhase("grading");
    try {
      const res = await gradeMutation.mutateAsync({
        vendor: vendor.trim(),
        lotId: lotId.trim() || undefined,
        notes: notes.trim() || undefined,
        sampleSize: sampleNum,
        items: usable.map((p) => ({
          label: p.file.name.slice(0, 160),
          fruit: p.result!.fruit,
          freshness: p.result!.freshness,
          pFresh: p.result!.pFresh,
          confidence: p.result!.confidence,
        })),
      });
      const shown: ResultPhoto[] = res.summary.photos.map((g, i) => ({
        label: g.photoId ?? usable[i]?.file.name ?? `photo-${i + 1}`,
        fruit: g.fruit,
        freshness: g.freshness_status,
        pFresh: g.p_fresh,
        confidence: g.confidence,
        grade: g.grade as Grade,
        reasons: g.reasons,
        thumb: usable[i]?.url,
      }));
      const dev = usable.filter((p) => p.result!.engine === "device").length;
      setResult({
        id: res.id,
        summary: res.summary,
        photos: shown,
        notes: notes.trim() || null,
        failed: current.filter((p) => p.status === "failed").map((p) => ({ name: p.file.name, error: p.error ?? "Classification failed" })),
        engines: `${dev} on-device, ${usable.length - dev} on server`,
      });
      setPhase("result");
      await Promise.all([utils.qc.list.invalidate(), utils.qc.scorecard.invalidate()]);
      toast.success(`Batch graded: ${res.summary.verdict.replace(/_/g, " ").toLowerCase()}`);
    } catch (err) {
      setPhase("edit");
      setGradeError(err instanceof Error ? err.message : "Could not grade the batch");
    }
  };

  const start = async (gradeOnlyClassified = false) => {
    setTouched(true);
    setGradeError(null);
    if (vendor.trim().length === 0) {
      document.getElementById("qc-vendor")?.focus();
      return;
    }
    if (sampleInvalid) {
      document.getElementById("qc-sample")?.focus();
      return;
    }
    if (photos.length === 0) return;
    setCancelled(false);
    setNotice(null);
    if (!gradeOnlyClassified) {
      // Retry photos that failed earlier, then classify everything still queued.
      setPhotos((prev) => prev.map((p) => (p.status === "failed" ? { ...p, status: "queued", error: undefined } : p)));
      const ctl = new AbortController();
      abortRef.current = ctl;
      setPhase("classifying");
      const queue = photosRef.current.filter((p) => p.status !== "done").map((p) => ({ ...p, status: "queued" as const }));
      await classifyQueue({
        photos: queue,
        preferDevice: engine === "device" && canDevice,
        signal: ctl.signal,
        onUpdate: patchPhoto,
        onNotice: setNotice,
      });
      if (ctl.signal.aborted) {
        setPhase("edit");
        setCancelled(true);
        return;
      }
    }
    // state updates from the queue are flushed before the next macrotask
    await new Promise((r) => setTimeout(r, 0));
    await submitGrade(photosRef.current);
  };

  const cancel = () => abortRef.current?.abort();

  const openBatch = async (id: number) => {
    try {
      const data = await utils.qc.get.fetch({ id }, { staleTime: 0 });
      setOpened({
        id,
        summary: data.summary,
        notes: data.batch.notes,
        failed: [],
        photos: data.items.map((i) => ({
          label: i.label ?? `photo-${i.id}`,
          fruit: i.fruit,
          freshness: i.freshness,
          pFresh: i.pFresh,
          confidence: i.confidence,
          grade: i.grade as Grade,
          reasons: i.reasons,
        })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the batch");
    }
  };

  const busy = phase === "classifying" || phase === "grading";
  const pct = photos.length ? Math.round((settled / photos.length) * 100) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Business"
          title="Batch QC"
          description="Grade incoming produce from crate photos at the receiving dock. Every photo is classified, each lot gets an auditable accept, discount, reject or inspect verdict, and vendors are scored over time."
        />

        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
            <TabsTrigger value="grade" className="min-h-10">Grade a batch</TabsTrigger>
            <TabsTrigger value="history" className="min-h-10">History</TabsTrigger>
            <TabsTrigger value="vendors" className="min-h-10">Vendor scorecard</TabsTrigger>
          </TabsList>

          <TabsContent value="grade" className="space-y-6">
            {phase === "result" && result ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Saved as batch #{result.id}. Classified {result.engines}.
                  </p>
                  <Button variant="dark" onClick={reset}>
                    <RotateCcw className="h-4 w-4" />
                    Grade another batch
                  </Button>
                </div>
                {result.failed.length > 0 && (
                  <div className="rounded-3xl border border-border bg-white p-5" role="alert" data-testid="failed-list">
                    <p className="font-bold text-graphite">
                      {result.failed.length} photo{result.failed.length === 1 ? "" : "s"} could not be classified and {result.failed.length === 1 ? "was" : "were"} excluded
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {result.failed.map((f, i) => (
                        <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <StatusTag tone="negative">Failed</StatusTag>
                          <span className="min-w-0 break-all font-medium text-graphite">{f.name}</span>
                          <span className="text-muted-foreground">{f.error}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm text-muted-foreground">Excluded photos are not graded as anything and do not count toward the percentages.</p>
                  </div>
                )}
                <BatchResults summary={result.summary} photos={result.photos} batchId={result.id} notes={result.notes} />
              </div>
            ) : (
              <>
                <Card>
                  <CardContent className="space-y-6">
                    <div className="grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="qc-vendor">Vendor</Label>
                        <Input
                          id="qc-vendor"
                          value={vendor}
                          maxLength={120}
                          disabled={busy}
                          required
                          aria-invalid={vendorMissing}
                          aria-describedby={vendorMissing ? "qc-vendor-err" : undefined}
                          onChange={(e) => setVendor(e.target.value)}
                          placeholder="e.g. Green Valley Farms"
                          autoComplete="off"
                        />
                        {vendorMissing && (
                          <p id="qc-vendor-err" className="text-sm font-medium text-signal-red-orange">
                            Vendor is required.
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="qc-lot">Lot ID (optional)</Label>
                        <Input id="qc-lot" value={lotId} maxLength={80} disabled={busy} onChange={(e) => setLotId(e.target.value)} placeholder="e.g. LOT-2041" autoComplete="off" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="qc-sample">Declared sample size (optional)</Label>
                        <Input
                          id="qc-sample"
                          inputMode="numeric"
                          value={sampleSize}
                          disabled={busy}
                          aria-invalid={sampleInvalid}
                          aria-describedby="qc-sample-help"
                          onChange={(e) => setSampleSize(e.target.value.replace(/[^\d]/g, ""))}
                          placeholder="Units you physically sampled"
                        />
                        <p id="qc-sample-help" className={cn("text-sm", sampleInvalid ? "font-medium text-signal-red-orange" : "text-muted-foreground")}>
                          {sampleInvalid ? "Enter a whole number between 1 and 100000." : "A mismatch with the number of photos is flagged in the report."}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="qc-notes">Notes (optional)</Label>
                        <Textarea id="qc-notes" value={notes} maxLength={2000} disabled={busy} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Truck temperature, delivery issues, PO number" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="fn-heading-sm text-graphite">Photos</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {photos.length} of {MAX_PHOTOS} photos. JPEG, PNG or WebP. Photograph randomly chosen units across the lot.
                        </p>
                      </div>
                      {canDevice && (
                        <div className="flex gap-1 rounded-3xl bg-fog p-1" role="group" aria-label="Classification engine">
                          {(
                            [
                              ["device", "On-device", Cpu],
                              ["server", "Server", Cloud],
                            ] as const
                          ).map(([key, label, Icon]) => (
                            <button
                              key={key}
                              type="button"
                              disabled={busy}
                              aria-pressed={engine === key}
                              onClick={() => chooseEngine(key)}
                              className={cn(
                                "flex min-h-11 items-center gap-2 rounded-3xl px-4 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                                engine === key ? "bg-white text-graphite" : "text-muted-foreground"
                              )}
                            >
                              <Icon className="h-4 w-4" aria-hidden="true" />
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!busy) setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        if (!busy) addFiles(e.dataTransfer.files);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-4 py-8 text-center transition-colors",
                        dragging ? "border-ember-orange bg-fog" : "border-border bg-white"
                      )}
                      data-testid="dropzone"
                    >
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-fog">
                        <ImagePlus className="h-6 w-6 text-ember-orange" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-medium text-graphite">Drag photos here, or choose them from your device.</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button variant="secondary" disabled={busy || photos.length >= MAX_PHOTOS} onClick={() => fileRef.current?.click()}>
                          <Upload className="h-4 w-4" />
                          Choose photos
                        </Button>
                        <Button variant="secondary" disabled={busy || photos.length >= MAX_PHOTOS} onClick={() => cameraRef.current?.click()}>
                          <Camera className="h-4 w-4" />
                          Take photo
                        </Button>
                      </div>
                      <input
                        ref={fileRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        className="sr-only"
                        tabIndex={-1}
                        aria-label="Choose batch photos"
                        data-testid="photo-input"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <input
                        ref={cameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        tabIndex={-1}
                        aria-label="Take a batch photo with the camera"
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </div>

                    {photos.length === 0 ? (
                      <EmptyState
                        icon={PackageSearch}
                        title="No photos yet"
                        description="Add at least one photo of the produce in this lot. For a representative verdict use 20 or more photos."
                        actionLabel="Choose photos"
                        onAction={() => fileRef.current?.click()}
                      />
                    ) : (
                      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" data-testid="thumb-grid">
                        {photos.map((p) => (
                          <li key={p.id} className="relative" data-status={p.status}>
                            <div className="aspect-square overflow-hidden rounded-2xl bg-fog">
                              <img src={p.url} alt={p.file.name} loading="lazy" className="h-full w-full object-cover" />
                            </div>
                            <div className="mt-1 flex items-center gap-1">
                              {p.status === "running" ? (
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ember-orange" aria-label="Classifying" />
                              ) : (
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "h-2 w-2 shrink-0 rounded-full",
                                    p.status === "done" && "bg-verdant-green",
                                    p.status === "failed" && "bg-signal-red-orange",
                                    p.status === "queued" && "bg-muted-foreground/40"
                                  )}
                                />
                              )}
                              <span className="truncate text-xs font-medium text-graphite" title={p.error ?? p.file.name}>
                                {p.status === "done" ? p.result?.fruit : p.status === "failed" ? "Failed" : p.status === "running" ? "Working" : "Queued"}
                              </span>
                              <span className="sr-only">{p.file.name}</span>
                            </div>
                            {p.status === "failed" && p.error ? <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{p.error}</p> : null}
                            {!busy && (
                              <button
                                type="button"
                                onClick={() => removePhoto(p.id)}
                                aria-label={`Remove ${p.file.name}`}
                                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-white text-graphite focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {(busy || settled > 0) && (
                      <div className="space-y-2" role="status" aria-live="polite" data-testid="progress">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-bold text-graphite">
                            {phase === "grading" ? "Grading the batch" : phase === "classifying" ? "Classifying photos one by one" : "Classification paused"}
                          </span>
                          <span className="text-muted-foreground">
                            {settled} of {photos.length} - {counts.done} classified{counts.failed ? `, ${counts.failed} failed` : ""}
                          </span>
                        </div>
                        <Progress value={pct} aria-label="Classification progress" />
                      </div>
                    )}

                    {notice && (
                      <p className="rounded-2xl bg-fog p-3 text-sm font-medium text-graphite" role="status">
                        {notice}
                      </p>
                    )}
                    {cancelled && (
                      <p className="rounded-2xl bg-fog p-3 text-sm font-medium text-graphite" role="status">
                        Cancelled after {counts.done} classified photo{counts.done === 1 ? "" : "s"}. Grade the batch to continue with the remaining photos, or grade only what is classified.
                      </p>
                    )}
                    {gradeError && (
                      <p className="rounded-2xl bg-fog p-3 text-sm font-medium text-signal-red-orange" role="alert">
                        {gradeError}
                      </p>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {phase === "classifying" ? (
                        <Button variant="dark" size="lg" onClick={cancel}>
                          <X className="h-4 w-4" />
                          Cancel
                        </Button>
                      ) : (
                        <Button size="lg" disabled={busy || photos.length === 0} onClick={() => start(false)}>
                          {phase === "grading" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          {phase === "grading" ? "Grading" : "Grade batch"}
                        </Button>
                      )}
                      {cancelled && counts.done > 0 && (
                        <Button variant="outline" size="lg" disabled={busy} onClick={() => start(true)}>
                          Grade {counts.done} classified
                        </Button>
                      )}
                      {photos.length > 0 && !busy && (
                        <Button variant="ghost" size="lg" onClick={reset}>
                          Clear all
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Photo grades inherit the classifier's errors. This supports your receiving decision; it does not replace physical inspection.
                    </p>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            {opened ? (
              <div className="space-y-6">
                <Button variant="ghost" onClick={() => setOpened(null)}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to history
                </Button>
                <BatchResults summary={opened.summary} photos={opened.photos} batchId={opened.id} notes={opened.notes} title={`Batch #${opened.id}`} />
              </div>
            ) : (
              <BatchHistory onOpen={openBatch} onStart={() => setTab("grade")} />
            )}
          </TabsContent>

          <TabsContent value="vendors">
            <VendorScorecard onStart={() => setTab("grade")} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
