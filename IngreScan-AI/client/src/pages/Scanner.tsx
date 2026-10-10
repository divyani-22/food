import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { Upload, Type, Loader2 } from "lucide-react";
import { ProfileCompletionBanner } from "@/components/ProfileCompletionBanner";

export default function Scanner() {
  const [, setLocation] = useLocation();
  const { data: profile } = trpc.profile.get.useQuery();
  const [inputType, setInputType] = useState<"text" | "image">("text");
  const [productName, setProductName] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);


  const uploadImageMutation = trpc.scanner.uploadImage.useMutation();
  const createScanMutation = trpc.scanner.createScan.useMutation();
  const processOCRMutation = trpc.scanner.processOCR.useMutation();
  const analyzeIngredientsMutation = trpc.analysis.analyzeIngredients.useMutation();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 16 * 1024 * 1024) {
        toast.error("File size must be less than 16MB");
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    setIsProcessing(true);
    try {
      let scanData: any = { productName, inputType };

      if (inputType === "image" && imageFile) {
        const reader = new FileReader();
        reader.readAsDataURL(imageFile);
        await new Promise((resolve) => { reader.onloadend = resolve; });
        const base64 = (reader.result as string).split(",")[1];
        
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Ingredient Scanner</h1>
          <p className="text-muted-foreground mt-2">Upload photos or enter ingredients manually</p>
        </div>

        <ProfileCompletionBanner hasProfile={!!profile} />

        <Card>
          <CardHeader>
            <CardTitle>Product Information</CardTitle>
            <CardDescription>Start by entering the product name</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="productName">Product Name (Optional)</Label>
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

        <Tabs value={inputType} onValueChange={(v) => setInputType(v as "text" | "image")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text"><Type className="mr-2 h-4 w-4" />Text Input</TabsTrigger>
            <TabsTrigger value="image"><Upload className="mr-2 h-4 w-4" />Image Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="text">
            <Card>
              <CardHeader>
                <CardTitle>Enter Ingredients</CardTitle>
                <CardDescription>Type or paste the ingredient list</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="e.g., Sugar, Maltodextrin, Cocoa Solids, Milk Solids, Liquid Glucose..."
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  rows={8}
                  disabled={isProcessing}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="image">
            <Card>
              <CardHeader>
                <CardTitle>Upload Label Image</CardTitle>
                <CardDescription>Take a clear photo of the ingredient label</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-8 text-center">
                    {imagePreview ? (
                      <div className="space-y-4">
                        <img src={imagePreview} alt="Preview" className="max-h-64 mx-auto rounded" />
                        <Button variant="outline" onClick={() => { setImageFile(null); setImagePreview(null); }} disabled={isProcessing}>
                          Change Image
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <Label htmlFor="imageUpload" className="cursor-pointer">
                          <div className="text-sm text-muted-foreground mb-2">Click to upload or drag and drop</div>
                          <div className="text-xs text-muted-foreground">PNG, JPG up to 16MB</div>
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
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={() => setLocation("/dashboard")} disabled={isProcessing}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isProcessing || (inputType === "text" && !ingredients.trim()) || (inputType === "image" && !imageFile)}>
            {isProcessing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</> : "Analyze Ingredients"}
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
