import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Upload, Type, Loader2, Camera, Package, ScanLine } from "lucide-react";
import { PageHeader } from "@/components/brand/PageHeader";
import { ProfileCompletionBanner } from "@/components/ProfileCompletionBanner";

export default function Scanner() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery();
  const [inputType, setInputType] = useState<"text" | "image">("text");
  const [productName, setProductName] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);


  // Pre-fill product name when arriving from the Expiry Tracker (/scanner?prefill=...)
  useEffect(() => {
    try {
      const prefill = new URLSearchParams(window.location.search).get("prefill");
      if (prefill) setProductName(prefill);
    } catch {
      // ignore
    }
  }, []);

  const uploadImageMutation = trpc.scanner.uploadImage.useMutation();
  const createScanMutation = trpc.scanner.createScan.useMutation();
  const processOCRMutation = trpc.scanner.processOCR.useMutation();
  const analyzeIngredientsMutation = trpc.analysis.analyzeIngredients.useMutation();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ""; // allow re-selecting the same file
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }
      if (file.size > 16 * 1024 * 1024) {
        toast.error("File size must be less than 16MB");
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.onerror = () => {
        setImageFile(null);
        toast.error("Could not read the selected file");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    setIsProcessing(true);
    try {
      let scanData: any = { productName: productName.trim() || undefined, inputType };

      if (inputType === "image" && imageFile) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read the selected file"));
          reader.readAsDataURL(imageFile);
        });
        const base64 = dataUrl.split(",")[1] ?? "";
        
        const uploadResult = await uploadImageMutation.mutateAsync({
          fileName: imageFile.name,
          fileData: base64,
          mimeType: imageFile.type,
        });
        
        scanData.imageUrl = uploadResult.url;
        scanData.imageKey = uploadResult.fileKey;
      } else if (inputType === "text") {
        if (!ingredients.trim()) {
          toast.error("Please enter ingredients");
          setIsProcessing(false);
          return;
        }
        scanData.rawIngredients = ingredients;
      }

      const { scanId } = await createScanMutation.mutateAsync(scanData);

      if (inputType === "image" && scanData.imageUrl) {
        toast.info("Extracting ingredients from image...");
        const ocrResult = await processOCRMutation.mutateAsync({
          scanId,
          imageUrl: scanData.imageUrl,
        });
        scanData.rawIngredients = ocrResult.ocrText;
      }

      if (!scanData.rawIngredients || !String(scanData.rawIngredients).trim()) {
        throw new Error("No ingredients could be extracted");
      }

      toast.info("Analyzing ingredients...");
      await analyzeIngredientsMutation.mutateAsync({
        scanId,
        ingredients: scanData.rawIngredients,
      });

      toast.success("Analysis complete!");
      setLocation(`/scan/${scanId}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to process scan");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-4xl space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Scan"
          title="Ingredient Scanner"
          description="Upload photos or enter ingredients manually"
        />

        <ProfileCompletionBanner hasProfile={!!profile || profileLoading} />

        <Card>
          <CardHeader>
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
                <Package className="h-5 w-5 text-ember-orange" />
              </span>
              <div className="min-w-0 space-y-1">
                <CardTitle>Product Information</CardTitle>
                <CardDescription>Start by entering the product name</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="productName" className="font-bold text-graphite">
                Product Name <span className="font-medium text-muted-foreground">(Optional)</span>
              </Label>
              <Input
                id="productName"
                placeholder="e.g., Bournvita, Maggi Noodles"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                disabled={isProcessing}
              />
            </div>
          </CardContent>
        </Card>

        <Tabs value={inputType} onValueChange={(v) => setInputType(v as "text" | "image")} className="gap-4">
          <TabsList className="grid h-12 w-full grid-cols-2 bg-white">
            <TabsTrigger value="text" className="data-[state=active]:bg-graphite data-[state=active]:text-white">
              <Type className="h-4 w-4" />Text Input
            </TabsTrigger>
            <TabsTrigger value="image" className="data-[state=active]:bg-graphite data-[state=active]:text-white">
              <Upload className="h-4 w-4" />Image Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <Card>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
                    <Type className="h-5 w-5 text-ember-orange" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <CardTitle>Enter Ingredients</CardTitle>
                    <CardDescription>Type or paste the ingredient list</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="e.g., Sugar, Maltodextrin, Cocoa Solids, Milk Solids, Liquid Glucose..."
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  rows={8}
                  disabled={isProcessing}
                  className="min-h-48"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="image">
            <Card>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
                    <Camera className="h-5 w-5 text-ember-orange" />
                  </span>
                  <div className="min-w-0 space-y-1">
                    <CardTitle>Upload Label Image</CardTitle>
                    <CardDescription>Take a clear photo of the ingredient label</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {imagePreview ? (
                  <div className="space-y-4 rounded-3xl bg-fog p-4 text-center sm:p-6">
                    <img src={imagePreview} alt="Preview" className="mx-auto max-h-64 max-w-full rounded-2xl" />
                    <Button variant="outline" onClick={() => { setImageFile(null); setImagePreview(null); }} disabled={isProcessing}>
                      Change Image
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Label
                      htmlFor="imageUpload"
                      className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-[#dcdcdc] bg-fog px-6 py-10 text-center transition-colors hover:border-ember-orange sm:py-14"
                    >
                      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white" aria-hidden="true">
                        <Upload className="h-6 w-6 text-ember-orange" />
                      </span>
                      <span className="text-base font-bold text-graphite">Click to upload or drag and drop</span>
                      <span className="text-sm font-medium text-muted-foreground">PNG, JPG up to 16MB</span>
                    </Label>
                    <Input
                      id="imageUpload"
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                      disabled={isProcessing}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" size="lg" onClick={() => setLocation("/dashboard")} disabled={isProcessing} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={isProcessing || (inputType === "text" && !ingredients.trim()) || (inputType === "image" && !imageFile)}
            className="w-full sm:w-auto"
          >
            {isProcessing ? <><Loader2 className="h-4 w-4 animate-spin" />Processing...</> : <><ScanLine className="h-4 w-4" />Analyze Ingredients</>}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
