import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ScanLine, History, MessageSquare, User, Sparkles, Refrigerator, Barcode, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: scans, isLoading: scansLoading } = trpc.scanner.getUserScans.useQuery({ limit: 5 });
  const { data: inventory = [] } = trpc.inventory.list.useQuery();
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery();

  const expiringItems = inventory.filter((i) => i.status === "expiring_soon" || i.status === "expired");

  const quickActions = [
    { icon: Refrigerator, title: "Expiry Tracker", description: "EcoFridge food expiry system", href: "/fridge", color: "bg-blue-600 text-white" },
    { icon: Barcode, title: "Open Food Facts", description: "Global barcode & Nutri-Score", href: "/openfoodfacts", color: "bg-emerald-600 text-white" },
    { icon: ScanLine, title: "Packaged Scanner", description: "Analyze food ingredients", href: "/scanner", color: "bg-primary text-primary-foreground" },
    { icon: Sparkles, title: "Fresh Produce AI", description: "Inspect fruit freshness & rot", href: "/produce", color: "bg-purple-600 text-white" },
    { icon: History, title: "Scan History", description: "View past analyses", href: "/history", color: "bg-amber-600 text-white" },
    { icon: MessageSquare, title: "Ask AI", description: "Chat about food safety", href: "/chat", color: "bg-teal-600 text-white" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Welcome back! Monitor your food safety journey.</p>
        </div>

        {expiringItems.length > 0 && (
          <Card className="border-amber-400/80 bg-amber-500/10">
            <CardHeader className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
                    <AlertTriangle className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-amber-800 dark:text-amber-300">
                      {expiringItems.length} Food Item{expiringItems.length === 1 ? "" : "s"} Expiring Soon!
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Check your fridge and consume them before they go to waste.
                    </CardDescription>
                  </div>
                </div>
                <Link href="/fridge">
                  <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white shrink-0">
                    Open Fridge Tracker
                  </Button>
                </Link>
              </div>
            </CardHeader>
          </Card>
        )}

        <div>
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {quickActions.map((action, index) => {
              const Icon = action.icon;
              return (
                <Link key={index} href={action.href}>
                  <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                    <CardHeader>
                      <div className={`h-12 w-12 rounded-lg ${action.color} flex items-center justify-center mb-2`}>
                        <Icon className="h-6 w-6" />
                      </div>
                      <CardTitle className="text-lg">{action.title}</CardTitle>
                      <CardDescription>{action.description}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Recent Scans</h2>
            <Link href="/history"><Button variant="ghost" size="sm">View All</Button></Link>
          </div>
          <div className="space-y-4">
            {scansLoading ? (
              <><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></>
            ) : scans && scans.length > 0 ? (
              scans.map((scan) => (
                <Link key={scan.id} href={`/scan/${scan.id}`}>
                  <Card className="hover:bg-accent cursor-pointer">
                    <CardHeader className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">{scan.productName || "Unnamed Product"}</CardTitle>
                          <CardDescription>{new Date(scan.createdAt).toLocaleDateString()} • {scan.inputType === "image" ? "Image Scan" : "Text Entry"}</CardDescription>
                        </div>
                        {scan.analysisComplete && scan.riskScore != null && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Risk Score:</span>
                            <span className={`text-lg font-bold ${scan.riskScore < 30 ? "text-green-600" : scan.riskScore < 60 ? "text-yellow-600" : "text-red-600"}`}>{scan.riskScore}</span>
                          </div>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              ))
            ) : (
              <Card><CardContent className="py-12 text-center"><ScanLine className="h-12 w-12 text-muted-foreground mx-auto mb-4" /><p className="text-muted-foreground mb-4">No scans yet</p><Link href="/scanner"><Button>Start Your First Scan</Button></Link></CardContent></Card>
            )}
          </div>
        </div>

        {!profile && !profileLoading && (
          <Card className="border-primary/50 bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" />Complete Your Profile</CardTitle>
              <CardDescription>Add your health information for personalized risk analysis</CardDescription>
            </CardHeader>
            <CardContent><Link href="/profile"><Button>Set Up Profile</Button></Link></CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
