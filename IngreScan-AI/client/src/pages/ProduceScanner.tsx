import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/brand/PageHeader";
import { StatusTag } from "@/components/brand/StatusTag";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toLocalDateInput } from "@/lib/utils";
import {
  Sparkles,
  Upload,
  Camera,
  Clock,
  Info,
  Trash2,
  PlusCircle,
  RotateCcw,
  History as HistoryIcon,
  Utensils,
  Refrigerator,
  Apple,
  Leaf,
  Banana,
  Cherry,
  Salad,
  ScanLine,
} from "lucide-react";

interface PredictionResult {
  fruit: string;
  fruit_kr: string;
  confidence: number;
  p_fresh: number;
  freshness_status: "fresh" | "normal" | "rotten";
  freshness_kr: string;
  badge_color: string;
  status_message: string;
  shelf_life_days: number;
  storage_tips: string;
  cooking_tips: string;
  image_url: string;
  top_candidates: Array<{
    code: string;
    name_kr: string;
    probability: number;
  }>;
}

interface InventoryItem {
  id: number;
  name: string;
  fruit_type: string;
  freshness: string;
  p_fresh: number;
  confidence: number;
  image_url: string;
  expiry_date?: string;
  days_left: number;
  storage_tip: string;
  created_at: string;
}

// SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS" with no zone marker;
// parse it as UTC so it displays correctly in local time.
function formatDbTimestamp(ts?: string): string {
  if (!ts) return "";
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts) ? ts.replace(" ", "T") + "Z" : ts;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

// Days remaining until a YYYY-MM-DD expiry (local), falling back to the stored value.
function daysUntil(expiry: string | undefined, fallback: number): number {
  if (!expiry) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiry);
  if (!m) return fallback;
  const target = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

interface HistoryItem {
  id: number;
  fruit_type: string;
  fruit_name_kr: string;
  freshness: string;
  freshness_kr: string;
  p_fresh: number;
  confidence: number;
  image_url: string;
  created_at: string;
}

export default function ProduceScanner() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [samples, setSamples] = useState<Array<{ filename: string; label: string; url: string }>>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [isAddingToInventory, setIsAddingToInventory] = useState(false);
  const [activeTab, setActiveTab] = useState("scan");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Load samples, inventory, and history on mount
  useEffect(() => {
    loadSamples();
    loadInventory();
    loadHistory();
  }, []);

  const loadSamples = async () => {
    try {
      const res = await fetch("/api/freshguard/samples");
      if (res.ok) {
        const data = await res.json();
        setSamples(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    }
  };

  // Pantry and history are stored per user in MySQL (tRPC); the Flask service only classifies images.
  const utils = trpc.useUtils();
  const recordScan = trpc.produce.recordScan.useMutation();
  const addInventoryMutation = trpc.produce.addInventory.useMutation();
  const deleteInventoryMutation = trpc.produce.deleteInventory.useMutation();
  const clearHistoryMutation = trpc.produce.clearHistory.useMutation();

  const loadInventory = async () => {
    try {
      const data = await utils.produce.listInventory.fetch();
      setInventory(Array.isArray(data) ? (data as InventoryItem[]) : []);
    } catch {
      // ignore
    }
  };

  const loadHistory = async () => {
    try {
      const data = await utils.produce.listHistory.fetch();
      setHistoryList(Array.isArray(data) ? (data as HistoryItem[]) : []);
    } catch {
      // ignore
    }
  };

  /** Save a successful classification to this user's history (never blocks showing the result). */
  const saveScanToHistory = async (data: PredictionResult) => {
    try {
      await recordScan.mutateAsync({
        fruit: data.fruit,
        fruitName: data.fruit_kr,
        freshness: data.freshness_status,
        freshnessLabel: data.freshness_kr,
        pFresh: data.p_fresh,
        confidence: data.confidence,
        imageUrl: data.image_url ?? "",
      });
      await loadHistory();
    } catch {
      toast.error("Result shown, but it could not be saved to your history.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Reset so selecting the same file again still fires onChange
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setSelectedImage(base64);
      analyzeBase64(base64);
    };
    reader.onerror = () => toast.error("Could not read the selected file");
    reader.readAsDataURL(file);
  };

  const analyzeBase64 = async (base64Img: string) => {
    setIsAnalyzing(true);
    setResult(null);
    try {
      const res = await fetch("/api/freshguard/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Img }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to analyze image" }));
        throw new Error(err.error || "Analysis failed");
      }
      const data: PredictionResult = await res.json();
      setResult(data);
      void saveScanToHistory(data);
      toast.success(`Identified ${data.fruit_kr} as ${data.freshness_kr}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to analyze produce freshness");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const analyzeSample = async (sampleFilename: string, sampleUrl: string) => {
    setIsAnalyzing(true);
    setSelectedImage(sampleUrl);
    setResult(null);
    try {
      const res = await fetch(`/api/freshguard/predict?sample=${encodeURIComponent(sampleFilename)}`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Failed to load sample prediction");
      }
      const data: PredictionResult = await res.json();
      setResult(data);
      void saveScanToHistory(data);
      toast.success(`Identified sample: ${data.fruit_kr}.`);
    } catch (err: any) {
      toast.error(err.message || "Sample analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addToInventory = async () => {
    if (!result) return;
    setIsAddingToInventory(true);
    try {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (result.shelf_life_days || 3));
      const expiryStr = toLocalDateInput(expiry);

      await addInventoryMutation.mutateAsync({
        name: result.fruit_kr,
        fruit: result.fruit,
        freshness: result.freshness_status,
        pFresh: result.p_fresh,
        confidence: result.confidence,
        imageUrl: result.image_url ?? "",
        storageTip: result.storage_tips,
        expiryDate: expiryStr,
      });
      toast.success(`Saved ${result.fruit_kr} to Fridge Inventory!`);
      await loadInventory();
      setActiveTab("inventory");
    } catch (err: any) {
      toast.error(err?.message || "Failed to add to inventory");
    } finally {
      setIsAddingToInventory(false);
    }
  };

  const deleteInventoryItem = async (id: number) => {
    try {
      await deleteInventoryMutation.mutateAsync({ id });
      toast.success("Item removed from inventory");
      await loadInventory();
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete item");
    }
  };

  const clearHistory = async () => {
    try {
      await clearHistoryMutation.mutateAsync();
      toast.success("History cleared");
      await loadHistory();
    } catch (err: any) {
      toast.error(err?.message || "Failed to clear history");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fresh":
        return <StatusTag tone="positive">Fresh</StatusTag>;
      case "normal":
        return <StatusTag tone="caution">Normal</StatusTag>;
      case "rotten":
        return <StatusTag tone="negative">Rotten</StatusTag>;
      default:
        return <StatusTag tone="neutral">{status}</StatusTag>;
    }
  };

  // Colour roles for freshness: fresh = positive, normal = caution, rotten = negative.
  const freshnessText = (status: string) =>
    status === "fresh"
      ? "text-verdant-green"
      : status === "normal"
        ? "text-sunset-orange"
        : status === "rotten"
          ? "text-signal-red-orange"
          : "text-graphite";
  const freshnessBar = (status: string) =>
    status === "fresh"
      ? "[&>[data-slot=progress-indicator]]:bg-verdant-green"
      : status === "normal"
        ? "[&>[data-slot=progress-indicator]]:bg-sunset-orange"
        : status === "rotten"
          ? "[&>[data-slot=progress-indicator]]:bg-signal-red-orange"
          : "[&>[data-slot=progress-indicator]]:bg-graphite";

  const supportedProduce = [
    "Apple",
    "Banana",
    "Bell Pepper",
    "Carrot",
    "Cucumber",
    "Mango",
    "Orange",
    "Potato",
    "Strawberry",
    "Tomato",
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="FreshGuard AI"
          title="Fresh Produce AI Inspector"
          description="Inspect fruits & vegetables in real time. Detect spoilage, estimate shelf life, and get optimal storage and cooking tips powered by PyTorch EfficientNet-B0."
          actions={
            <Button
              variant="outline"
              onClick={() => {
                setSelectedImage(null);
                setResult(null);
              }}
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          }
        />

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
          <TabsList className="grid h-[52px] w-full grid-cols-3 bg-white sm:max-w-lg">
            <TabsTrigger value="scan" className="h-11 min-w-0 px-2 data-[state=active]:bg-fog">
              <Sparkles className="text-ember-orange" />
              <span className="truncate">
                <span className="hidden sm:inline">AI </span>Inspector
              </span>
            </TabsTrigger>
            <TabsTrigger value="inventory" className="h-11 min-w-0 px-2 data-[state=active]:bg-fog">
              <Refrigerator className="text-graphite" />
              <span className="truncate">
                <span className="hidden sm:inline">Fridge </span>Pantry ({inventory.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="history" className="h-11 min-w-0 px-2 data-[state=active]:bg-fog">
              <HistoryIcon className="text-graphite" />
              <span className="truncate">History</span>
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: AI SCANNER */}
          <TabsContent value="scan">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
              {/* Left Column: Upload & Camera & Samples */}
              <div className="lg:col-span-5">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog">
                        <Camera className="h-5 w-5 text-ember-orange" />
                      </span>
                      Image Input
                    </CardTitle>
                    <CardDescription>
                      Upload a photo of fruit or capture directly with your camera.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Image Preview Box */}
                    <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-fog">
                      {selectedImage ? (
                        <img
                          src={selectedImage}
                          alt="Produce Preview"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="space-y-2 p-6 text-center">
                          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white">
                            <Upload className="h-6 w-6 text-ember-orange" />
                          </div>
                          <p className="text-sm font-bold text-graphite">Drag & drop or click below to upload</p>
                          <p className="text-xs text-muted-foreground">Supported: JPG, PNG, WEBP</p>
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <input
                        type="file"
                        ref={cameraInputRef}
                        accept="image/*"
                        capture="environment"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full"
                      >
                        <Upload className="h-4 w-4" /> Upload File
                      </Button>
                      <Button
                        onClick={() => cameraInputRef.current?.click()}
                        className="w-full"
                      >
                        <Camera className="h-4 w-4" /> Camera
                      </Button>
                    </div>

                    {/* Quick Test Samples */}
                    <div className="border-t pt-5">
                      <p className="mb-3 text-sm font-bold text-graphite">Quick Test Samples</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {samples.length > 0 ? (
                          samples.map((sample) => (
                            <Button
                              key={sample.filename}
                              variant="secondary"
                              onClick={() => analyzeSample(sample.filename, sample.url)}
                              className="min-w-0 justify-start px-4 text-sm"
                            >
                              <span className="truncate">{sample.label}</span>
                            </Button>
                          ))
                        ) : (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => analyzeSample("apple.jpg", "/static/samples/apple.jpg")}
                              className="text-sm"
                            >
                              <Apple className="h-4 w-4 text-signal-red-orange" /> Apple
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => analyzeSample("banana.jpg", "/static/samples/banana.jpg")}
                              className="text-sm"
                            >
                              <Banana className="h-4 w-4 text-sunset-orange" /> Banana
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => analyzeSample("tomato.jpg", "/static/samples/tomato.jpg")}
                              className="text-sm"
                            >
                              <Cherry className="h-4 w-4 text-signal-red-orange" /> Tomato
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

              </div>

              {/* Right Column: AI Results Card */}
              <div className="lg:col-span-7 lg:row-span-2 lg:self-stretch">
                {isAnalyzing ? (
                  <Card className="flex h-full min-h-[320px] items-center justify-center p-12">
                    <div className="space-y-4 text-center">
                      <div className="relative mx-auto h-16 w-16">
                        <div className="absolute inset-0 animate-spin rounded-full border-4 border-fog border-t-verdant-green" />
                        <div className="absolute inset-0 grid place-items-center">
                          <ScanLine className="h-6 w-6 text-graphite" />
                        </div>
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-graphite">AI Inspecting Freshness...</h3>
                        <p className="text-sm text-muted-foreground">
                          Running EfficientNet-B0 multitask neural classification
                        </p>
                      </div>
                    </div>
                  </Card>
                ) : result ? (
                  <div className="space-y-6">
                    {/* Primary Verdict Card */}
                    <Card className="gap-0 py-0 md:py-0">
                      <div className="space-y-6 p-5 md:p-7">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-fog">
                              <Leaf className={`h-7 w-7 ${freshnessText(result.freshness_status)}`} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <h2 className="fn-heading-sm text-graphite">{result.fruit_kr}</h2>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Identification Confidence: {result.confidence}%
                              </p>
                            </div>
                          </div>
                          <div>{getStatusBadge(result.freshness_status)}</div>
                        </div>

                        {/* Status Message */}
                        <div className="rounded-2xl bg-fog p-4 text-sm leading-relaxed">
                          <p className="mb-1 font-bold text-graphite">AI Assessment Verdict:</p>
                          <p className="text-muted-foreground">{result.status_message}</p>
                        </div>

                        {/* Metrics */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-3 rounded-2xl bg-fog p-4">
                            <p className="text-xs font-bold text-muted-foreground">Freshness Probability</p>
                            <p className={`fn-metric text-4xl ${freshnessText(result.freshness_status)}`}>
                              {result.p_fresh}%
                            </p>
                            <Progress
                              value={Math.max(0, Math.min(100, result.p_fresh))}
                              className={`h-2 bg-white ${freshnessBar(result.freshness_status)}`}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              ≥70%: Fresh | 30-70%: Normal | ≤30%: Rotten
                            </p>
                          </div>

                          <div className="flex items-center gap-3 rounded-2xl bg-fog p-4">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white">
                              <Clock
                                className={`h-5 w-5 ${result.shelf_life_days > 0 ? "text-graphite" : "text-signal-red-orange"}`}
                              />
                            </span>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-muted-foreground">Estimated Shelf Life</p>
                              <p className="fn-metric mt-1 text-xl text-graphite">
                                {result.shelf_life_days > 0 ? `${result.shelf_life_days} Days Left` : "Expired / Spoilage"}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Storage Tip */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-graphite">
                            <Refrigerator className="h-4 w-4 text-ember-orange" /> Recommended Storage Method
                          </div>
                          <p className="rounded-2xl bg-fog p-4 text-sm leading-relaxed text-muted-foreground">
                            {result.storage_tips}
                          </p>
                        </div>

                        {/* Culinary / Cooking Advice */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-graphite">
                            <Utensils className="h-4 w-4 text-ember-orange" /> Recommended Usage & Cooking
                          </div>
                          <p className="rounded-2xl bg-fog p-4 text-sm leading-relaxed text-muted-foreground">
                            {result.cooking_tips}
                          </p>
                        </div>

                        {/* Top Predictions */}
                        {result.top_candidates && result.top_candidates.length > 0 && (
                          <div className="space-y-3 border-t pt-5">
                            <p className="text-xs font-bold text-muted-foreground">Model Predictions Distribution:</p>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                              {result.top_candidates.map((c) => (
                                <div key={c.code} className="rounded-2xl bg-fog p-3 text-center text-xs">
                                  <span className="block truncate font-bold text-graphite">{c.name_kr}</span>
                                  <div className="fn-metric mt-1 text-base text-graphite">{c.probability}%</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Add to Pantry Button */}
                        <Button
                          size="lg"
                          onClick={addToInventory}
                          disabled={isAddingToInventory}
                          className="w-full"
                        >
                          <PlusCircle className="h-5 w-5" />
                          {isAddingToInventory ? "Saving..." : "Save to Fridge Pantry"}
                        </Button>
                      </div>
                    </Card>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[320px] items-center justify-center rounded-3xl bg-white p-8 text-center md:p-12">
                    <div className="max-w-sm space-y-3">
                      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-fog">
                        <Salad className="h-7 w-7 text-verdant-green" />
                      </span>
                      <h3 className="fn-heading-sm text-graphite">Ready for Inspection</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Upload or snap a photo of any supported fruit or vegetable on the left to see instant freshness analysis, shelf life advice, and storage recommendations.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div className="lg:col-span-5">
                {/* Supported Fruits Guide */}
                <section className="rounded-3xl bg-white p-5 md:p-7">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-graphite">
                    <Info className="h-4 w-4 text-muted-foreground" /> Supported Produce (10 Types)
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {supportedProduce.map((p) => (
                      <span
                        key={p}
                        className="rounded-3xl bg-fog px-3 py-1.5 text-xs font-bold text-graphite"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  </section>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: INVENTORY */}
          <TabsContent value="inventory" className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="fn-heading-sm text-graphite">Current Fridge Pantry</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Track perishables to reduce food waste and eat fresh.
                </p>
              </div>
              <Button variant="outline" onClick={loadInventory}>
                <RotateCcw className="h-4 w-4" /> Refresh
              </Button>
            </div>

            {inventory.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center md:p-12">
                <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-fog">
                  <Refrigerator className="h-7 w-7 text-muted-foreground" />
                </span>
                <p className="font-bold text-graphite">Your Fridge Pantry is Empty</p>
                <p className="mt-1 text-sm text-muted-foreground">Scan produce items using the AI Inspector and click "Save to Fridge Pantry".</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inventory.map((item) => (
                  <Card key={item.id} className="gap-4">
                    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{item.name}</CardTitle>
                        <CardDescription className="text-xs capitalize">{item.fruit_type}</CardDescription>
                      </div>
                      {getStatusBadge(item.freshness)}
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {item.image_url && (
                        <div className="h-36 overflow-hidden rounded-2xl bg-fog">
                          <img
                            src={item.image_url}
                            alt={item.name}
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}
                      <div className="flex justify-between gap-3 border-b py-2">
                        <span className="text-muted-foreground">Shelf Life:</span>
                        <span className="fn-metric text-graphite">
                          {(() => {
                            const d = daysUntil(item.expiry_date, item.days_left);
                            return d < 0 ? `Expired ${-d} day${d === -1 ? "" : "s"} ago` : `${d} Days`;
                          })()}
                        </span>
                      </div>
                      {item.expiry_date && (
                        <div className="flex justify-between gap-3 border-b py-2">
                          <span className="text-muted-foreground">Est. Expiry:</span>
                          <span className="font-bold text-graphite">{item.expiry_date}</span>
                        </div>
                      )}
                      {item.storage_tip && (
                        <p className="line-clamp-2 rounded-2xl bg-fog p-3 text-xs leading-relaxed text-muted-foreground">
                          {item.storage_tip}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => deleteInventoryItem(item.id)}
                        className="mt-1 w-full"
                      >
                        <Trash2 className="h-4 w-4 text-signal-red-orange" /> Remove / Consumed
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: SCAN HISTORY */}
          <TabsContent value="history" className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h3 className="fn-heading-sm text-graphite">Produce Scan History</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  History of recent freshness inspections recorded by FreshGuard AI.
                </p>
              </div>
              {historyList.length > 0 && (
                <Button variant="outline" onClick={clearHistory}>
                  <Trash2 className="h-4 w-4 text-signal-red-orange" /> Clear History
                </Button>
              )}
            </div>

            {historyList.length === 0 ? (
              <div className="rounded-3xl bg-white p-8 text-center md:p-12">
                <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-fog">
                  <HistoryIcon className="h-7 w-7 text-muted-foreground" />
                </span>
                <p className="font-bold text-graphite">No Scan History Yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Scan produce items to build your history log.</p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded-3xl border bg-white">
                {historyList.map((h) => (
                  <div
                    key={h.id}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-fog/60 sm:flex-row sm:items-center sm:justify-between md:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {h.image_url ? (
                        <img
                          src={h.image_url}
                          alt={h.fruit_name_kr}
                          className="h-12 w-12 shrink-0 rounded-xl bg-fog object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-fog">
                          <Leaf className="h-5 w-5 text-verdant-green" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-graphite">
                          {h.fruit_name_kr}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Confidence: {h.confidence}% | Freshness Prob: {h.p_fresh}%
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDbTimestamp(h.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="pl-[60px] sm:pl-0">{getStatusBadge(h.freshness)}</div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
