import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanLine, Calendar } from "lucide-react";

export default function History() {
  const { data: scans, isLoading } = trpc.scanner.getUserScans.useQuery({ limit: 100 });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Scan History</h1>
            <p className="text-muted-foreground mt-2">View all your previous ingredient analyses</p>
          </div>
          <Link href="/scanner"><Button><ScanLine className="mr-2 h-4 w-4" />New Scan</Button></Link>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : scans && scans.length > 0 ? (
          <div className="grid gap-4">
            {scans.map((scan) => (
              <Link key={scan.id} href={`/scan/${scan.id}`}>
                <Card className="hover:bg-accent cursor-pointer transition-colors">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl">{scan.productName || "Unnamed Product"}</CardTitle>
                        <CardDescription className="flex items-center gap-4 mt-2">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(scan.createdAt).toLocaleDateString()}
                          </span>
                          <span>{scan.inputType === "image" ? "Image Scan" : "Text Entry"}</span>
                        </CardDescription>
                      </div>
                      {scan.analysisComplete && scan.riskScore !== null && (
                        <div className="text-center ml-4">
                          <div className="text-xs text-muted-foreground mb-1">Risk Score</div>
                          <div className={`text-3xl font-bold ${
                            scan.riskScore < 30 ? "text-green-600" :
                            scan.riskScore < 60 ? "text-yellow-600" :
                            "text-red-600"
                          }`}>
                            {scan.riskScore}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  {scan.rawIngredients && (
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2">{scan.rawIngredients}</p>
                    </CardContent>
                  )}
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-16 text-center">
              <ScanLine className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No scans yet</h3>
              <p className="text-muted-foreground mb-6">Start analyzing food ingredients to build your history</p>
              <Link href="/scanner"><Button>Start Your First Scan</Button></Link>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
