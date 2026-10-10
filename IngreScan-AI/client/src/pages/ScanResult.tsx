import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useRoute, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle, Info, ExternalLink, Lightbulb, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AIChatBox } from "@/components/AIChatBox";

export default function ScanResult() {
  const [, params] = useRoute("/scan/:id");
  const scanId = parseInt(params?.id || "0");
  const [loadingAlternatives, setLoadingAlternatives] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const { data, isLoading } = trpc.scanner.getScan.useQuery({ scanId });
  const suggestAlternativesMutation = trpc.analysis.suggestAlternatives.useMutation();
  const { data: chatHistory, refetch: refetchChat } = trpc.chat.getHistory.useQuery({ scanId });
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  useEffect(() => {
    if (chatHistory) {
      setMessages(chatHistory.map(h => ({ role: h.role as "user" | "assistant", content: h.content })));
    }
  }, [chatHistory]);

  const handleSuggestAlternatives = async () => {
    if (!data?.scan.productName) {
      toast.error("Product name is required for alternatives");
      return;
    }
    setLoadingAlternatives(true);
    try {
      await suggestAlternativesMutation.mutateAsync({
        scanId,
        productName: data.scan.productName,
      });
      toast.success("Alternatives generated!");
      window.location.reload();
    } catch (error: any) {
      toast.error(error.message || "Failed to generate alternatives");
    } finally {
      setLoadingAlternatives(false);
    }
  };

  const getRiskColor = (level?: string) => {
    switch (level) {
      case "safe": return "text-green-600 bg-green-100";
      case "low": return "text-blue-600 bg-blue-100";
      case "moderate": return "text-yellow-600 bg-yellow-100";
      case "high": return "text-orange-600 bg-orange-100";
      case "severe": return "text-red-600 bg-red-100";
      default: return "text-gray-600 bg-gray-100";
    }
  };

  const getRiskIcon = (level?: string) => {
    if (level === "safe") return <CheckCircle className="h-5 w-5" />;
    if (["high", "severe"].includes(level || "")) return <AlertTriangle className="h-5 w-5" />;
    return <Info className="h-5 w-5" />;
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6 pb-24">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Scan not found</p>
          <Link href="/dashboard"><Button className="mt-4">Go to Dashboard</Button></Link>
        </div>
      </DashboardLayout>
    );
  }

  const { scan, ingredients, alternatives } = data;

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-24">
        {/* Label Padhega India Educational Banner */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Lightbulb className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h3 className="font-semibold text-lg mb-2">Label Padhega India 🇮🇳</h3>
                <p className="text-sm text-muted-foreground">
                  This analysis helps you understand hidden ingredients like sugars (maltodextrin, corn syrup), 
                  excessive salt, unhealthy oils, and harmful additives. Learn to read labels and make informed choices. 
                  Remember: ingredients are listed by quantity - the first few are the most abundant!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{scan.productName || "Scan Result"}</h1>
            <p className="text-muted-foreground mt-2">Scanned on {new Date(scan.createdAt).toLocaleDateString()}</p>
          </div>
          {scan.riskScore !== null && (
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Risk Score</div>
              <div className={`text-4xl font-bold ${scan.riskScore < 30 ? "text-green-600" : scan.riskScore < 60 ? "text-yellow-600" : "text-red-600"}`}>
                {scan.riskScore}
              </div>
              <div className="text-xs text-muted-foreground">out of 100</div>
            </div>
          )}
        </div>

        {scan.imageUrl && (
          <Card>
            <CardHeader><CardTitle>Scanned Image</CardTitle></CardHeader>
            <CardContent><img src={scan.imageUrl} alt="Product label" className="max-h-64 rounded-lg" /></CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Ingredient Analysis</CardTitle>
            <CardDescription>{ingredients.length} ingredients detected</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {ingredients.map((ingredient) => (
                <div key={ingredient.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-lg">{ingredient.name}</h4>
                      {ingredient.scientificName && <p className="text-sm text-muted-foreground italic">{ingredient.scientificName}</p>}
                      {ingredient.category && <Badge variant="outline" className="mt-1">{ingredient.category}</Badge>}
                    </div>
                    {ingredient.riskLevel && (
                      <Badge className={getRiskColor(ingredient.riskLevel)}>
                        {getRiskIcon(ingredient.riskLevel)}
                        <span className="ml-1 capitalize">{ingredient.riskLevel}</span>
                      </Badge>
                    )}
                  </div>
                  {ingredient.personalizedRisk && (
                    <div className="bg-muted p-3 rounded-lg">
                      <p className="text-sm font-medium mb-1">Personalized Risk:</p>
                      <p className="text-sm">{ingredient.personalizedRisk}</p>
                    </div>
                  )}
                  <div className="grid md:grid-cols-3 gap-3 text-sm">
                    {ingredient.shortTermEffects && (
                      <div>
                        <p className="font-medium text-muted-foreground">Short-term:</p>
                        <p>{ingredient.shortTermEffects}</p>
                      </div>
                    )}
                    {ingredient.longTermEffects && (
                      <div>
                        <p className="font-medium text-muted-foreground">Long-term:</p>
                        <p>{ingredient.longTermEffects}</p>
                      </div>
                    )}
                    {ingredient.sideEffects && (
                      <div>
                        <p className="font-medium text-muted-foreground">Side Effects:</p>
                        <p>{ingredient.sideEffects}</p>
                      </div>
                    )}
                  </div>
                  {ingredient.sources && (
                    <div className="text-xs text-muted-foreground">
                      Sources: {JSON.parse(ingredient.sources).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Lightbulb className="h-5 w-5" />Healthier Alternatives</CardTitle>
                <CardDescription>Safer product options based on your profile</CardDescription>
              </div>
              {alternatives.length === 0 && (
                <Button onClick={handleSuggestAlternatives} disabled={loadingAlternatives}>
                  {loadingAlternatives ? "Generating..." : "Generate Alternatives"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {alternatives.length > 0 ? (
              <div className="space-y-4">
                {alternatives.map((alt) => (
                  <div key={alt.id} className="border rounded-lg p-4 space-y-2">
                    <h4 className="font-semibold text-lg">{alt.productName}</h4>
                    <p className="text-sm">{alt.reason}</p>
                    {alt.scientificJustification && (
                      <div className="bg-muted p-3 rounded-lg text-sm">
                        <p className="font-medium mb-1">Scientific Justification:</p>
                        <p>{alt.scientificJustification}</p>
                      </div>
                    )}
                    {alt.sources && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                        Sources: {JSON.parse(alt.sources).join(", ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Click "Generate Alternatives" to see healthier options</p>
            )}
          </CardContent>
        </Card>

        {/* Inline Chat Section */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Ask Questions About This Scan
                </CardTitle>
                <CardDescription>
                  Get instant answers about ingredients, health impacts, and alternatives
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowChat(!showChat)}
              >
                {showChat ? "Hide Chat" : "Show Chat"}
              </Button>
            </div>
          </CardHeader>
          {showChat && (
            <CardContent>
              <div className="h-[400px]">
                <AIChatBox
                  messages={messages}
                  onSendMessage={async (message: string) => {
                    setMessages(prev => [...prev, { role: "user", content: message }]);
                    try {
                      const response = await sendMessageMutation.mutateAsync({ message, scanId });
                      setMessages(prev => [...prev, { role: "assistant", content: response.message }]);
                      refetchChat();
                    } catch (error: any) {
                      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${error.message || "Failed to get response"}` }]);
                    }
                  }}
                  placeholder="Ask about ingredients, health impacts, or safer alternatives..."
                />
              </div>
            </CardContent>
          )}
        </Card>

        <div className="flex gap-4 mt-6">
          <Link href="/scanner"><Button>Scan Another Product</Button></Link>
          <Link href="/history"><Button variant="outline">View History</Button></Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
