import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanLine, Calendar, ChevronRight, Type, Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/brand/PageHeader";
import { StatusTag, scoreTone, type Tone } from "@/components/brand/StatusTag";
import { cn } from "@/lib/utils";
import { ErrorState } from "@/components/qc/States";

export default function History() {
  const { data: scans, isLoading, error, refetch } = trpc.scanner.getUserScans.useQuery({ limit: 100 });

  return (
    <DashboardLayout>
      <div className="space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Track"
          title="Scan History"
          description="View all your previous ingredient analyses"
          actions={
            <Button asChild className="w-full md:w-auto">
              <Link href="/scanner"><ScanLine className="h-4 w-4" />New Scan</Link>
            </Button>
          }
        />

        {isLoading ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading scan history">
            <Skeleton className="h-28 w-full rounded-3xl bg-white" />
            <Skeleton className="h-28 w-full rounded-3xl bg-white" />
            <Skeleton className="h-28 w-full rounded-3xl bg-white" />
          </div>
        ) : error ? (
          <ErrorState message={`Could not load your scans. ${error.message}`} onRetry={() => void refetch()} />
        ) : scans && scans.length > 0 ? (
          <ul className="grid gap-3">
            {scans.map((scan) => {
              const tone = scoreTone(scan.riskScore);
              const showScore = scan.analysisComplete && scan.riskScore != null;
              return (
                <li key={scan.id}>
                  <Link
                    href={`/scan/${scan.id}`}
                    className="group flex items-start gap-4 rounded-3xl border border-border bg-white p-4 transition-colors hover:border-[#dcdcdc] hover:bg-[#fcfcfc] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:p-6"
                  >
                    <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog sm:grid" aria-hidden="true">
                      {scan.inputType === "image" ? (
                        <ImageIcon className="h-5 w-5 text-ember-orange" />
                      ) : (
                        <Type className="h-5 w-5 text-ember-orange" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <h2 className="truncate text-lg font-bold leading-tight text-graphite md:text-xl">
                        {scan.productName || "Unnamed Product"}
                      </h2>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {new Date(scan.createdAt).toLocaleDateString()}
                        </span>
                        <span>{scan.inputType === "image" ? "Image Scan" : "Text Entry"}</span>
                      </div>
                      {scan.rawIngredients && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">{scan.rawIngredients}</p>
                      )}
                    </div>
                    {showScore && (
                      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                        <span className="text-xs font-bold text-muted-foreground">Risk Score</span>
                        <span
                          className={cn("fn-metric text-3xl md:text-4xl", scoreTextClass(tone.tone))}
                        >
                          {scan.riskScore}
                        </span>
                        <StatusTag tone={tone.tone} className="hidden sm:inline-flex">{tone.label}</StatusTag>
                      </div>
                    )}
                    <ChevronRight className="mt-1 hidden h-5 w-5 shrink-0 self-center text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-3xl bg-white px-6 py-14 text-center md:py-20">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-fog" aria-hidden="true">
              <ScanLine className="h-8 w-8 text-ember-orange" />
            </span>
            <h2 className="fn-heading-sm mt-6 text-graphite">No scans yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-muted-foreground">Start analyzing food ingredients to build your history</p>
            <Button asChild variant="dark" className="mt-8 w-full sm:w-auto">
              <Link href="/scanner">Start Your First Scan</Link>
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function scoreTextClass(tone: Tone) {
  switch (tone) {
    case "positive":
      return "text-verdant-green";
    case "caution":
      return "text-sunset-orange";
    case "negative":
      return "text-signal-red-orange";
    default:
      return "text-graphite";
  }
}
