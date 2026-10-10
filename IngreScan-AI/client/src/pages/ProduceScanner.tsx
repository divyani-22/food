import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { 
  Sparkles, 
  Upload, 
  Camera, 
  Calendar, 
  Clock, 
  Info, 
  Trash2, 
  PlusCircle, 
  RotateCcw, 
  History as HistoryIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Utensils,
  Refrigerator
} from "lucide-react";

interface PredictionResult {
  fruit: string;
  fruit_kr: string;
  emoji: string;
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
    emoji: string;
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
        setSamples(data);
      }
    } catch {
      // ignore
    }
  };

  const loadInventory = async () => {
    try {
      const res = await fetch("/api/freshguard/inventory");
      if (res.ok) {
        const data = await res.json();
        setInventory(data);
      }
    } catch {
      // ignore
    }
  };

  const loadHistory = async () => {
    try {
      const res = await fetch("/api/freshguard/history");
      if (res.ok) {
        const data = await res.json();
        setHistoryList(data);
      }
    } catch {
      // ignore
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setSelectedImage(base64);
        analyzeBase64(base64);
      };
      reader.readAsDataURL(file);
    }
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
      loadHistory();
      toast.success(`Identified ${data.emoji} ${data.fruit_kr} as ${data.freshness_kr}!`);
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
        throw new Error("Failed to load sample prediction");
      }
      const data: PredictionResult = await res.json();
      setResult(data);
      loadHistory();
      toast.success(`Identified sample ${data.emoji} ${data.fruit_kr}!`);
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
      const expiryStr = expiry.toISOString().split("T")[0];

      const res = await fetch("/api/freshguard/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${result.emoji} ${result.fruit_kr}`,
          fruit: result.fruit,
          freshness_status: result.freshness_status,
          p_fresh: result.p_fresh,
          confidence: result.confidence,
          image_url: result.image_url,
          shelf_life_days: result.shelf_life_days,
          storage_tips: result.storage_tips,
          expiry_date: expiryStr,
        }),
      });

      if (res.ok) {
        toast.success(`Saved ${result.fruit_kr} to Fridge Inventory!`);
        loadInventory();
        setActiveTab("inventory");
      } else {
        toast.error("Failed to add to inventory");
      }
    } catch {
      toast.error("Failed to add to inventory");
    } finally {
      setIsAddingToInventory(false);
    }
  };

  const deleteInventoryItem = async (id: number) => {
    try {
      const res = await fetch(`/api/freshguard/inventory/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Item removed from inventory");
        loadInventory();
      }
    } catch {
      toast.error("Failed to delete item");
    }
  };

  const clearHistory = async () => {
    try {
      const res = await fetch("/api/freshguard/history", { method: "DELETE" });
      if (res.ok) {
        toast.success("History cleared");
        loadHistory();
      }
    } catch {
      toast.error("Failed to clear history");
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "fresh":
        return (
          <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 px-3 py-1 text-sm">
            <CheckCircle2 className="h-4 w-4" /> Fresh (신선)
          </Badge>
        );
      case "normal":
        return (
          <Badge className="bg-amber-500 hover:bg-amber-600 text-white gap-1 px-3 py-1 text-sm">
            <AlertTriangle className="h-4 w-4" /> Normal (보통)
          </Badge>
        );
      case "rotten":
        return (
          <Badge className="bg-rose-600 hover:bg-rose-700 text-white gap-1 px-3 py-1 text-sm">
            <XCircle className="h-4 w-4" /> Rotten (상함/폐기)
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-12">
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-primary/10 border border-emerald-500/20 shadow-sm">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-3xl">🍎</span>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Fresh Produce AI Inspector
              </h1>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                FreshGuard AI
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm md:text-base max-w-2xl">
              Inspect fruits & vegetables in real time. Detect spoilage, estimate shelf life, and get optimal storage and cooking tips powered by PyTorch EfficientNet-B0.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedImage(null);
                setResult(null);
              }}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid grid-cols-3 max-w-md">
            <TabsTrigger value="scan" className="gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600" /> AI Inspector
            </TabsTrigger>
            <TabsTrigger value="inventory" className="gap-2">
              <Refrigerator className="h-4 w-4 text-blue-600" /> Fridge Pantry ({inventory.length})
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <HistoryIcon className="h-4 w-4 text-amber-600" /> History
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: AI SCANNER */}
          <TabsContent value="scan" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Upload & Camera & Samples */}
              <div className="lg:col-span-5 space-y-6">
                <Card className="border-2 border-dashed hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Camera className="h-5 w-5 text-primary" /> Image Input
                    </CardTitle>
                    <CardDescription>
                      Upload a photo of fruit or capture directly with your camera.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Image Preview Box */}
                    <div className="relative aspect-video rounded-xl overflow-hidden bg-muted/40 border flex items-center justify-center group">
                      {selectedImage ? (
                        <img
                          src={selectedImage}
                          alt="Produce Preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-6 space-y-2">
                          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 flex items-center justify-center text-emerald-600">
                            <Upload className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-medium">Drag & drop or click below to upload</p>
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
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="gap-2 w-full"
                      >
                        <Upload className="h-4 w-4" /> Upload File
                      </Button>
                      <Button
                        onClick={() => cameraInputRef.current?.click()}
                        className="gap-2 w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <Camera className="h-4 w-4" /> Camera
                      </Button>
                    </div>

                    {/* Quick Test Samples */}
                    <div className="pt-3 border-t">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Quick Test Samples
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {samples.length > 0 ? (
                          samples.map((sample) => (
                            <Button
                              key={sample.filename}
                              variant="secondary"
                              size="sm"
                              onClick={() => analyzeSample(sample.filename, sample.url)}
                              className="text-xs h-9 justify-start truncate"
                            >
                              {sample.label}
                            </Button>
                          ))
                        ) : (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => analyzeSample("apple.jpg", "/static/samples/apple.jpg")}
                              className="text-xs"
                            >
                              🍎 Apple
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => analyzeSample("banana.jpg", "/static/samples/banana.jpg")}
                              className="text-xs"
                            >
                              🍌 Banana
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => analyzeSample("tomato.jpg", "/static/samples/tomato.jpg")}
                              className="text-xs"
                            >
                              🍅 Tomato
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Supported Fruits Guide */}
                <Card className="bg-card/50">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary" /> Supported Produce (10 Types)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground grid grid-cols-2 gap-1 pb-3">
                    <span>🍎 Apple (사과)</span>
                    <span>🍌 Banana (바나나)</span>
                    <span>🫑 Bell Pepper (피망)</span>
                    <span>🥕 Carrot (당근)</span>
                    <span>🥒 Cucumber (오이)</span>
                    <span>🥭 Mango (망고)</span>
                    <span>🍊 Orange (오렌지)</span>
                    <span>🥔 Potato (감자)</span>
                    <span>🍓 Strawberry (딸기)</span>
                    <span>🍅 Tomato (토마토)</span>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column: AI Results Card */}
              <div className="lg:col-span-7">
                {isAnalyzing ? (
                  <Card className="h-full flex items-center justify-center p-12 border-emerald-500/30">
                    <div className="text-center space-y-4">
                      <div className="relative w-16 h-16 mx-auto">
                        <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20 border-t-emerald-600 animate-spin" />
                        <div className="absolute inset-2 rounded-full flex items-center justify-center text-2xl">
                          🍏
                        </div>
                      </div>
                      <div>
                        <h3 className="font-bold text-lg">AI Inspecting Freshness...</h3>
                        <p className="text-sm text-muted-foreground">
                          Running EfficientNet-B0 multitask neural classification
                        </p>
                      </div>
                    </div>
                  </Card>
                ) : result ? (
                  <div className="space-y-6">
                    {/* Primary Verdict Card */}
                    <Card className="overflow-hidden border-2 shadow-md">
                      <div className="p-6 bg-gradient-to-br from-card via-card to-muted/30 space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
                          <div className="flex items-center gap-3">
                            <span className="text-5xl">{result.emoji}</span>
                            <div>
                              <div className="flex items-center gap-2">
                                <h2 className="text-2xl font-black capitalize">{result.fruit}</h2>
                                <span className="text-lg text-muted-foreground font-semibold">({result.fruit_kr})</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Identification Confidence: {result.confidence}%
                              </p>
                            </div>
                          </div>
                          <div>
                            {getStatusBadge(result.freshness_status)}
                          </div>
                        </div>

                        {/* Status Message */}
                        <div className="p-4 rounded-xl bg-muted/50 border text-sm leading-relaxed">
                          <p className="font-semibold text-foreground mb-1">AI Assessment Verdict:</p>
                          <p className="text-muted-foreground">{result.status_message}</p>
                        </div>

                        {/* Metrics Bar */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="p-4 rounded-xl border bg-card space-y-2">
                            <div className="flex justify-between text-xs font-semibold">
                              <span>Freshness Probability</span>
                              <span className="text-emerald-600">{result.p_fresh}%</span>
                            </div>
                            <Progress value={result.p_fresh} className="h-2" />
                            <p className="text-[11px] text-muted-foreground">
                              ≥70%: Fresh | 30-70%: Normal | ≤30%: Rotten
                            </p>
                          </div>

                          <div className="p-4 rounded-xl border bg-card flex items-center gap-3">
                            <div className="p-3 rounded-lg bg-primary/10 text-primary">
                              <Clock className="h-6 w-6" />
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground font-medium">Estimated Shelf Life</p>
                              <p className="text-xl font-bold text-foreground">
                                {result.shelf_life_days > 0 ? `${result.shelf_life_days} Days Left` : "Expired / Spoilage"}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Storage Tip */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                            <Refrigerator className="h-4 w-4 text-blue-500" /> Recommended Storage Method
                          </div>
                          <p className="text-xs md:text-sm bg-blue-500/5 p-3 rounded-lg border border-blue-500/20 text-muted-foreground">
                            {result.storage_tips}
                          </p>
                        </div>

                        {/* Culinary / Cooking Advice */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                            <Utensils className="h-4 w-4 text-amber-500" /> Recommended Usage & Cooking
                          </div>
                          <p className="text-xs md:text-sm bg-amber-500/5 p-3 rounded-lg border border-amber-500/20 text-muted-foreground">
                            {result.cooking_tips}
                          </p>
                        </div>

                        {/* Top Predictions */}
                        {result.top_candidates && result.top_candidates.length > 0 && (
                          <div className="space-y-2 pt-2 border-t">
                            <p className="text-xs font-semibold text-muted-foreground">Model Predictions Distribution:</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {result.top_candidates.map((c) => (
                                <div key={c.code} className="p-2 rounded-lg bg-muted/40 border text-center text-xs">
                                  <span>{c.emoji} {c.name_kr}</span>
                                  <div className="font-bold text-primary mt-0.5">{c.probability}%</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Add to Pantry Button */}
                        <Button
                          onClick={addToInventory}
                          disabled={isAddingToInventory}
                          className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md text-base py-5"
                        >
                          <PlusCircle className="h-5 w-5" />
                          {isAddingToInventory ? "Saving..." : "Save to Fridge Pantry"}
                        </Button>
                      </div>
                    </Card>
                  </div>
                ) : (
                  <Card className="h-full flex items-center justify-center p-12 text-center text-muted-foreground border-dashed">
                    <div className="space-y-3 max-w-sm">
                      <div className="text-5xl">🥗</div>
                      <h3 className="font-bold text-lg text-foreground">Ready for Inspection</h3>
                      <p className="text-xs leading-relaxed">
                        Upload or snap a photo of any supported fruit or vegetable on the left to see instant freshness analysis, shelf life advice, and storage recommendations.
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: INVENTORY */}
          <TabsContent value="inventory" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-foreground">Current Fridge Pantry</h3>
                <p className="text-xs text-muted-foreground">
                  Track perishables to reduce food waste and eat fresh.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={loadInventory} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Refresh
              </Button>
            </div>

            {inventory.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <Refrigerator className="h-12 w-12 mx-auto mb-3 opacity-40 text-blue-500" />
                <p className="font-semibold text-foreground">Your Fridge Pantry is Empty</p>
                <p className="text-xs mt-1">Scan produce items using the AI Inspector and click "Save to Fridge Pantry".</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inventory.map((item) => (
                  <Card key={item.id} className="overflow-hidden hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
                      <div>
                        <CardTitle className="text-base font-bold">{item.name}</CardTitle>
                        <CardDescription className="text-xs capitalize">{item.fruit_type}</CardDescription>
                      </div>
                      {getStatusBadge(item.freshness)}
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs">
                      {item.image_url && (
                        <div className="h-32 rounded-lg overflow-hidden bg-muted">
                          <img
                            src={item.image_url}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = "none";
                            }}
                          />
                        </div>
                      )}
                      <div className="flex justify-between py-1 border-b">
                        <span className="text-muted-foreground">Shelf Life:</span>
                        <span className="font-bold text-foreground">{item.days_left} Days</span>
                      </div>
                      {item.expiry_date && (
                        <div className="flex justify-between py-1 border-b">
                          <span className="text-muted-foreground">Est. Expiry:</span>
                          <span className="font-medium text-foreground">{item.expiry_date}</span>
                        </div>
                      )}
                      {item.storage_tip && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2 bg-muted/40 p-2 rounded">
                          {item.storage_tip}
                        </p>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteInventoryItem(item.id)}
                        className="w-full gap-2 text-xs h-8 mt-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove / Consumed
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: SCAN HISTORY */}
          <TabsContent value="history" className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-foreground">Produce Scan History</h3>
                <p className="text-xs text-muted-foreground">
                  History of recent freshness inspections recorded by FreshGuard AI.
                </p>
              </div>
              {historyList.length > 0 && (
                <Button variant="outline" size="sm" onClick={clearHistory} className="gap-2 text-rose-600">
                  <Trash2 className="h-4 w-4" /> Clear History
                </Button>
              )}
            </div>

            {historyList.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground">
                <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-40 text-amber-500" />
                <p className="font-semibold text-foreground">No Scan History Yet</p>
                <p className="text-xs mt-1">Scan produce items to build your history log.</p>
              </Card>
            ) : (
              <div className="divide-y rounded-xl border bg-card overflow-hidden">
                {historyList.map((h) => (
                  <div key={h.id} className="p-4 flex items-center justify-between hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-3">
                      {h.image_url ? (
                        <img
                          src={h.image_url}
                          alt={h.fruit_name_kr}
                          className="w-12 h-12 rounded-lg object-cover border"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-emerald-100 flex items-center justify-center text-xl">
                          🍏
                        </div>
                      )}
                      <div>
                        <p className="font-bold text-sm text-foreground">
                          {h.fruit_name_kr} <span className="text-xs font-normal text-muted-foreground capitalize">({h.fruit_type})</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Confidence: {h.confidence}% | Freshness Prob: {h.p_fresh}%
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(h.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div>
                      {getStatusBadge(h.freshness)}
                    </div>
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
