import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toLocalDateInput } from "@/lib/utils";
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ExternalLink,
  Flame,
  Globe,
  Info,
  Leaf,
  Plus,
  Refrigerator,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const SAMPLE_BARCODES = [
  { code: "8901030895470", name: "Maggi 2-Minute Noodles", flag: "🇮🇳" },
  { code: "3017620422003", name: "Nutella Hazelnut Spread", flag: "🌍" },
  { code: "737628064502", name: "Thai Kitchen Rice Noodles", flag: "🌏" },
  { code: "8901491101833", name: "Lay's Classic Salted Chips", flag: "🇮🇳" },
  { code: "5449000000996", name: "Coca-Cola Original", flag: "🌍" },
  { code: "8901262010047", name: "Amul Butter Pasteurized", flag: "🇮🇳" },
];

export default function OpenFoodFactsExplorer() {
  const [, setLocation] = useLocation();
  const [barcodeInput, setBarcodeInput] = useState("8901030895470");
  const [activeBarcode, setActiveBarcode] = useState("8901030895470");
  const [searchQuery, setSearchQuery] = useState("");
  // Only the submitted query drives the API call (not every keystroke)
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [activeTab, setActiveTab] = useState("barcode");

  // tRPC query for single barcode
  const {
    data: product,
    isLoading: isProductLoading,
    isError: isProductError,
    refetch: refetchProduct,
  } = trpc.openFoodFacts.getByBarcode.useQuery(
    { barcode: activeBarcode },
    { enabled: Boolean(activeBarcode) }
  );

  // tRPC query for product search
  const {
    data: searchResults = [],
    isLoading: isSearchLoading,
    refetch: refetchSearch,
  } = trpc.openFoodFacts.search.useQuery(
    { query: submittedQuery },
    { enabled: Boolean(submittedQuery && activeTab === "search") }
  );

  // tRPC mutations
  const createScanMutation = trpc.scanner.createScan.useMutation();
  const analyzeMutation = trpc.analysis.analyzeIngredients.useMutation();
  const addToInventoryMutation = trpc.inventory.add.useMutation();

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) {
      toast.error("Please enter a barcode number");
      return;
    }
    setActiveBarcode(barcodeInput.trim());
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toast.error("Please enter a product name to search");
      return;
    }
    const q = searchQuery.trim();
    if (q === submittedQuery) {
      refetchSearch();
    } else {
      setSubmittedQuery(q);
    }
  };

  // 1-Click Bridge to IngreScan-AI
  const handleAnalyzeWithAI = async () => {
    if (!product) return;
    if (!product.ingredientsText) {
      toast.error("No ingredients text available for this product on Open Food Facts.");
      return;
    }

    const toastId = toast.loading("Launching IngreScan-AI ingredient analysis...");
    try {
      const scanRes = await createScanMutation.mutateAsync({
        productName: `${product.brand ? product.brand + " " : ""}${product.productName}`,
        inputType: "text",
        rawIngredients: product.ingredientsText,
        imageUrl: product.imageUrl || undefined,
      });

      await analyzeMutation.mutateAsync({
        scanId: scanRes.scanId,
        ingredients: product.ingredientsText,
      });

      toast.success("Analysis complete! Redirecting to health risk report...", { id: toastId });
      setLocation(`/scan/${scanRes.scanId}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to analyze ingredients", { id: toastId });
    }
  };

  // 1-Click Bridge to Food Expiry Tracker (Fridge)
  const handleAddToFridge = async () => {
    if (!product) return;
    const toastId = toast.loading("Adding to your Food Expiry Tracker...");
    try {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 14); // 2 weeks default

      await addToInventoryMutation.mutateAsync({
        title: `${product.brand ? product.brand + " " : ""}${product.productName}`,
        category: product.category || "Snacks",
        quantity: "1 pack",
        storageLocation: "pantry",
        foodImageUrl: product.imageUrl || undefined,
        barcode: product.barcode,
        expiryDate: toLocalDateInput(expiry),
        notes: `Imported via Open Food Facts (Nutri-Score: ${product.nutriscoreGrade || "N/A"})`,
      });

      toast.success("Added to Expiry Tracker! View it in Fridge Tracker.", { id: toastId });
    } catch (err: any) {
      toast.error(err.message || "Failed to add to tracker", { id: toastId });
    }
  };

  const getNutriscoreColor = (grade: string | null) => {
    switch (grade) {
      case "A":
        return "bg-emerald-700 text-white";
      case "B":
        return "bg-emerald-500 text-white";
      case "C":
        return "bg-yellow-500 text-black";
      case "D":
        return "bg-amber-600 text-white";
      case "E":
        return "bg-rose-600 text-white";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getNovaColor = (group: number | null) => {
    switch (group) {
      case 1:
        return "bg-emerald-600 text-white";
      case 2:
        return "bg-blue-600 text-white";
      case 3:
        return "bg-amber-600 text-white";
      case 4:
        return "bg-rose-600 text-white";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <DashboardLayout>
      <div className="container py-8 space-y-8 max-w-7xl">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-3xl">🌐🔍</span>
              <h1 className="text-3xl font-bold tracking-tight">Open Food Facts Explorer</h1>
            </div>
            <p className="text-muted-foreground mt-1">
              Global food database integration with 3M+ packaged products. Scan barcodes, check Nutri-Score, NOVA Ultra-Processing ratings, and analyze with IngreScan-AI.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => setLocation("/fridge")}
            >
              <Refrigerator className="h-4 w-4 text-emerald-600" />
              Go to Fridge Tracker
            </Button>
          </div>
        </div>

        {/* Tab Selection */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid grid-cols-2 max-w-md">
            <TabsTrigger value="barcode" className="gap-2">
              <Barcode className="h-4 w-4" /> Barcode Lookup
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-4 w-4" /> Global Product Search
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Barcode Lookup */}
          <TabsContent value="barcode" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Barcode className="h-5 w-5 text-emerald-600" />
                  Scan or Enter Barcode
                </CardTitle>
                <CardDescription>
                  Enter an EAN-13, UPC, or Indian GTIN barcode to fetch verified food data from Open Food Facts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleBarcodeSubmit} className="flex gap-3">
                  <div className="relative flex-1">
                    <Barcode className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                    <Input
                      placeholder="e.g., 8901030895470"
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      className="pl-10 h-11 text-base font-mono"
                    />
                  </div>
                  <Button type="submit" size="lg" className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                    <Search className="h-4 w-4" /> Search Barcode
                  </Button>
                </form>

                {/* Sample Barcodes */}
                <div>
                  <span className="text-xs text-muted-foreground font-medium">Quick Demo Barcodes:</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {SAMPLE_BARCODES.map((s) => (
                      <Button
                        key={s.code}
                        variant="secondary"
                        size="sm"
                        className="text-xs h-8 gap-1.5"
                        onClick={() => {
                          setBarcodeInput(s.code);
                          setActiveBarcode(s.code);
                        }}
                      >
                        <span>{s.flag}</span>
                        <span className="font-semibold">{s.name}</span>
                        <span className="font-mono text-muted-foreground text-[10px]">({s.code})</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Product Details Display */}
            {isProductLoading ? (
              <div className="text-center py-16 text-muted-foreground space-y-2">
                <div className="inline-block animate-spin text-3xl">⏳</div>
                <p>Querying Open Food Facts database for barcode {activeBarcode}...</p>
              </div>
            ) : product ? (
              <Card className="overflow-hidden border-2 border-emerald-500/20 shadow-lg">
                <div className="bg-gradient-to-r from-emerald-500/10 via-background to-blue-500/10 p-6 border-b">
                  <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                    <div className="flex gap-5 items-center">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.productName}
                          className="h-28 w-28 object-contain rounded-xl bg-white border p-1 shadow-sm"
                        />
                      ) : (
                        <div className="h-28 w-28 rounded-xl bg-muted border flex items-center justify-center text-4xl">
                          🥫
                        </div>
                      )}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-xs">
                            Barcode: {product.barcode}
                          </Badge>
                          {product.brand && (
                            <Badge variant="secondary" className="text-xs">
                              {product.brand}
                            </Badge>
                          )}
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight">
                          {product.productName}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Category: {product.category}
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                      <Button
                        onClick={handleAnalyzeWithAI}
                        disabled={createScanMutation.isPending || analyzeMutation.isPending}
                        className="bg-emerald-600 hover:bg-emerald-700 gap-2 shadow"
                      >
                        <Sparkles className="h-4 w-4" />
                        Analyze with IngreScan-AI
                      </Button>

                      <Button
                        variant="outline"
                        onClick={handleAddToFridge}
                        disabled={addToInventoryMutation.isPending}
                        className="gap-2"
                      >
                        <Refrigerator className="h-4 w-4 text-emerald-600" />
                        Add to Fridge Tracker
                      </Button>
                    </div>
                  </div>
                </div>

                <CardContent className="p-6 space-y-6">
                  {/* Scores Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Nutri-Score */}
                    <Card className="bg-muted/40 border">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase font-semibold text-muted-foreground flex items-center justify-between">
                          Nutri-Score
                          <Info className="h-3.5 w-3.5" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        {product.nutriscoreGrade ? (
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-2xl font-extrabold px-3.5 py-1 rounded-lg ${getNutriscoreColor(
                                product.nutriscoreGrade
                              )}`}
                            >
                              {product.nutriscoreGrade}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Nutritional quality grade (A = Highest, E = Lowest)
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not calculated</span>
                        )}
                      </CardContent>
                    </Card>

                    {/* NOVA Group */}
                    <Card className="bg-muted/40 border">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase font-semibold text-muted-foreground flex items-center justify-between">
                          NOVA Classification
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        {product.novaGroup ? (
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-2xl font-extrabold px-3.5 py-1 rounded-lg ${getNovaColor(
                                product.novaGroup
                              )}`}
                            >
                              {product.novaGroup}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {product.novaGroup === 4
                                ? "Ultra-Processed Food (High UPF)"
                                : product.novaGroup === 3
                                ? "Processed Food"
                                : product.novaGroup === 2
                                ? "Culinary Ingredient"
                                : "Unprocessed / Whole Food"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not classified</span>
                        )}
                      </CardContent>
                    </Card>

                    {/* Eco-Score */}
                    <Card className="bg-muted/40 border">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs uppercase font-semibold text-muted-foreground flex items-center justify-between">
                          Eco-Score
                          <Leaf className="h-3.5 w-3.5 text-emerald-600" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-0">
                        {product.ecoscoreGrade ? (
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-2xl font-extrabold px-3.5 py-1 rounded-lg ${getNutriscoreColor(
                                product.ecoscoreGrade
                              )}`}
                            >
                              {product.ecoscoreGrade}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Environmental impact score
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Eco-Score N/A</span>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Nutrition per 100g Table */}
                  <Card className="border">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <Flame className="h-4 w-4 text-amber-500" />
                        Nutrition Facts (per 100g / 100ml)
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 text-center">
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Energy</p>
                          <p className="font-bold text-sm mt-0.5">
                            {product.nutriments.energyKcal != null ? `${product.nutriments.energyKcal} kcal` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Total Fat</p>
                          <p className="font-bold text-sm mt-0.5">
                            {product.nutriments.fat != null ? `${product.nutriments.fat}g` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Sat. Fat</p>
                          <p className="font-bold text-sm mt-0.5 text-rose-600">
                            {product.nutriments.saturatedFat != null ? `${product.nutriments.saturatedFat}g` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Sugars</p>
                          <p className="font-bold text-sm mt-0.5 text-amber-600">
                            {product.nutriments.sugars != null ? `${product.nutriments.sugars}g` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Salt / Sodium</p>
                          <p className="font-bold text-sm mt-0.5">
                            {product.nutriments.salt != null ? `${product.nutriments.salt}g` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Protein</p>
                          <p className="font-bold text-sm mt-0.5 text-emerald-600">
                            {product.nutriments.proteins != null ? `${product.nutriments.proteins}g` : "—"}
                          </p>
                        </div>
                        <div className="p-2.5 rounded-lg bg-muted/50 border">
                          <p className="text-xs text-muted-foreground">Dietary Fiber</p>
                          <p className="font-bold text-sm mt-0.5">
                            {product.nutriments.fiber != null ? `${product.nutriments.fiber}g` : "—"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Ingredients Section */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold flex items-center justify-between">
                      <span>Ingredients List (as declared on package)</span>
                      <Button
                        variant="link"
                        size="sm"
                        className="text-xs text-emerald-600 p-0 h-auto"
                        onClick={handleAnalyzeWithAI}
                      >
                        Deep AI Analysis →
                      </Button>
                    </h3>
                    <div className="p-4 rounded-xl bg-muted/30 border text-sm leading-relaxed">
                      {product.ingredientsText || "No ingredient list specified on this product entry."}
                    </div>

                    {product.allergens && product.allergens.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs font-semibold text-rose-600 flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" /> Contains Allergens:
                        </span>
                        {product.allergens.map((alg: string) => (
                          <Badge key={alg} variant="destructive" className="text-xs capitalize">
                            {alg}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-16 px-4 bg-muted/30 rounded-2xl border border-dashed text-muted-foreground space-y-2">
                <p>No product found for barcode &ldquo;{activeBarcode}&rdquo;.</p>
                <p className="text-xs">Try searching by product name in the next tab or use one of the demo barcodes.</p>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: Global Search */}
          <TabsContent value="search" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Search className="h-5 w-5 text-emerald-600" />
                  Search Global Food Catalog
                </CardTitle>
                <CardDescription>
                  Search millions of packaged foods by brand or name (e.g., Maggi, Amul, Oreo, Lays, Nutella).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSearchSubmit} className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                    <Input
                      placeholder="e.g., Maggi Noodles or Amul Butter..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 h-11 text-base"
                    />
                  </div>
                  <Button type="submit" size="lg" className="bg-emerald-600 hover:bg-emerald-700 gap-2">
                    <Search className="h-4 w-4" /> Search
                  </Button>
                </form>
              </CardContent>
            </Card>

            {isSearchLoading ? (
              <div className="text-center py-16 text-muted-foreground space-y-2">
                <div className="inline-block animate-spin text-3xl">⏳</div>
                <p>Searching Open Food Facts...</p>
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {searchResults.map((item: any, idx: number) => (
                  <Card key={`${item.barcode}-${idx}`} className="overflow-hidden flex flex-col justify-between hover:shadow-md transition-all">
                    <CardHeader className="pb-3">
                      <div className="flex items-start gap-3">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.productName}
                            className="h-16 w-16 object-contain rounded-lg border bg-white p-1"
                          />
                        ) : (
                          <div className="h-16 w-16 rounded-lg bg-muted border flex items-center justify-center text-2xl">
                            🥫
                          </div>
                        )}
                        <div className="flex-1">
                          <CardTitle className="text-base font-bold line-clamp-1">
                            {item.productName}
                          </CardTitle>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {item.brand || "Generic"} • {item.category}
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            {item.nutriscoreGrade && (
                              <Badge className={`text-xs ${getNutriscoreColor(item.nutriscoreGrade)}`}>
                                Nutri-Score {item.nutriscoreGrade}
                              </Badge>
                            )}
                            {item.novaGroup && (
                              <Badge className={`text-xs ${getNovaColor(item.novaGroup)}`}>
                                NOVA {item.novaGroup}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3 text-xs text-muted-foreground line-clamp-2">
                      {item.ingredientsText || "No ingredient text available."}
                    </CardContent>
                    <div className="p-3 border-t bg-muted/20 flex items-center justify-between gap-2 mt-auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="text-xs h-8 gap-1"
                        disabled={!item.barcode}
                        onClick={() => {
                          setBarcodeInput(item.barcode);
                          setActiveBarcode(item.barcode);
                          setActiveTab("barcode");
                        }}
                      >
                        <Barcode className="h-3.5 w-3.5" /> View Barcode
                      </Button>

                      {item.ingredientsText && (
                        <Button
                          size="sm"
                          className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 gap-1"
                          onClick={async () => {
                            const toastId = toast.loading("Analyzing with IngreScan-AI...");
                            try {
                              const scanRes = await createScanMutation.mutateAsync({
                                productName: `${item.brand ? item.brand + " " : ""}${item.productName}`,
                                inputType: "text",
                                rawIngredients: item.ingredientsText,
                                imageUrl: item.imageUrl || undefined,
                              });
                              await analyzeMutation.mutateAsync({
                                scanId: scanRes.scanId,
                                ingredients: item.ingredientsText,
                              });
                              toast.success("Done!", { id: toastId });
                              setLocation(`/scan/${scanRes.scanId}`);
                            } catch (e: any) {
                              toast.error(e.message, { id: toastId });
                            }
                          }}
                        >
                          <Sparkles className="h-3.5 w-3.5" /> AI Scan
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            ) : submittedQuery ? (
              <div className="text-center py-16 text-muted-foreground">
                No products found for &ldquo;{submittedQuery}&rdquo;. Try another term.
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
