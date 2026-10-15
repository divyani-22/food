import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/brand/PageHeader";
import { Ring } from "@/components/brand/PhoneMockup";
import { StatusTag, scoreTone } from "@/components/brand/StatusTag";
import { Card } from "@/components/ui/card";
import { RescueFridge } from "@/components/features/RescueFridge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { ScanLine, History, MessageSquare, User, Sparkles, Refrigerator, Barcode, AlertTriangle, ArrowRight, ChevronRight, ImageIcon, Type } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/qc/States";

export default function Dashboard() {
  const { data: scans, isLoading: scansLoading, error: scansError, refetch: refetchScans } = trpc.scanner.getUserScans.useQuery({ limit: 5 });
  const { data: inventory = [] } = trpc.inventory.list.useQuery();
  const { data: profile, isLoading: profileLoading } = trpc.profile.get.useQuery();

  const expiringItems = inventory.filter((i) => i.status === "expiring_soon" || i.status === "expired");
  const active = inventory.filter((i) => i.status !== "consumed");
  const kitchen = [
    { label: "Fresh", value: active.filter((i) => i.status === "fresh").length, color: "var(--fn-verdant-green)" },
    { label: "Expiring soon", value: active.filter((i) => i.status === "expiring_soon").length, color: "var(--fn-sunset-orange)" },
    { label: "Expired", value: active.filter((i) => i.status === "expired").length, color: "var(--fn-signal-red-orange)" },
  ];
  const latestScored = scans?.find((s) => s.analysisComplete && s.riskScore != null);

  const quickActions = [
    { icon: Refrigerator, title: "Expiry Tracker", description: "EcoFridge food expiry system", href: "/fridge", tint: "text-verdant-green" },
    { icon: Barcode, title: "Open Food Facts", description: "Global barcode & Nutri-Score", href: "/openfoodfacts", tint: "text-sky-blue" },
    { icon: ScanLine, title: "Packaged Scanner", description: "Analyze food ingredients", href: "/scanner", tint: "text-ember-orange" },
    { icon: Sparkles, title: "Fresh Produce AI", description: "Inspect fruit freshness & rot", href: "/produce", tint: "text-verdant-green" },
    { icon: History, title: "Scan History", description: "View past analyses", href: "/history", tint: "text-plum" },
    { icon: MessageSquare, title: "Ask AI", description: "Chat about food safety", href: "/chat", tint: "text-iris" },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8 md:space-y-10">
        <PageHeader
          eyebrow="Overview"
          title="Dashboard"
          description="Welcome back! Monitor your food safety journey."
          actions={
            <Button asChild><Link href="/scanner">
                <ScanLine className="h-4 w-4" />
                New scan
              </Link></Button>
          }
        />

        {expiringItems.length > 0 && (
          <div className="flex flex-col gap-4 rounded-3xl bg-white p-5 sm:flex-row sm:items-center sm:justify-between md:px-7">
            <div className="flex items-center gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog">
                <AlertTriangle className="h-5 w-5 text-sunset-orange" />
              </span>
              <div>
                <p className="text-base font-bold text-graphite">
                  {expiringItems.length} Food Item{expiringItems.length === 1 ? "" : "s"} Expiring Soon!
                </p>
                <p className="text-sm text-muted-foreground">
                  Check your fridge and consume them before they go to waste.
                </p>
              </div>
            </div>
            <Button variant="dark" size="sm" className="w-full shrink-0 sm:w-auto" asChild><Link href="/fridge">
                Open Fridge Tracker
                <ArrowRight className="h-4 w-4" />
              </Link></Button>
          </div>
        )}

        <RescueFridge />

        {/* At a glance — app-internal data cards */}
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="gap-5">
            <div className="flex items-center justify-between px-5 md:px-7">
              <h2 className="fn-heading-sm text-graphite">Your kitchen</h2>
              <Link href="/fridge" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-graphite hover:text-ember-orange">
                Fridge <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 px-5 md:gap-3 md:px-7">
              {kitchen.map((k) => (
                <div key={k.label} className="rounded-2xl bg-fog px-3 py-4 md:px-5">
                  <p className="fn-metric text-3xl md:text-4xl" style={{ color: k.value ? k.color : undefined }}>
                    {k.value}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-muted-foreground md:text-sm">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: k.color }} />
                    {k.label}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="gap-4">
            <div className="flex items-center justify-between px-5 md:px-7">
              <h2 className="fn-heading-sm text-graphite">Latest score</h2>
              {latestScored && (
                <Link href={`/scan/${latestScored.id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-graphite hover:text-ember-orange">
                  Report <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </div>
            <div className="flex items-center gap-5 px-5 md:px-7">
              {scansLoading ? (
                <Skeleton className="h-24 w-24 rounded-full" />
              ) : (
                <Ring
                  value={latestScored?.riskScore ?? 0}
                  color={
                    latestScored?.riskScore == null
                      ? "var(--fn-fog)"
                      : latestScored.riskScore < 30
                        ? "var(--fn-verdant-green)"
                        : latestScored.riskScore < 60
                          ? "var(--fn-sunset-orange)"
                          : "var(--fn-signal-red-orange)"
                  }
                >
                  <span className="fn-metric text-2xl text-graphite">{latestScored?.riskScore ?? "–"}</span>
                </Ring>
              )}
              <div className="min-w-0">
                {latestScored ? (
                  <>
                    <p className="truncate text-base font-bold text-graphite">{latestScored.productName || "Unnamed Product"}</p>
                    <StatusTag tone={scoreTone(latestScored.riskScore).tone} className="mt-2">
                      {scoreTone(latestScored.riskScore).label}
                    </StatusTag>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-graphite">No score yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">Scan a label to see its risk score here.</p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>

        <section>
          <h2 className="fn-heading-sm mb-4 text-graphite">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex h-full flex-col rounded-3xl border border-transparent bg-white p-4 transition-colors hover:border-[#dcdcdc] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-5"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-fog">
                    <Icon className={`h-5 w-5 ${action.tint}`} />
                  </span>
                  <span className="mt-4 text-[15px] font-bold leading-tight text-graphite md:text-base">{action.title}</span>
                  <span className="mt-1 text-[13px] leading-snug text-muted-foreground">{action.description}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="fn-heading-sm text-graphite">Recent Scans</h2>
            <Button variant="ghost" size="sm" asChild><Link href="/history">View All <ChevronRight className="h-4 w-4" /></Link></Button>
          </div>
          {scansLoading ? (
            <div className="space-y-3"><Skeleton className="h-20 w-full rounded-3xl" /><Skeleton className="h-20 w-full rounded-3xl" /></div>
          ) : scansError ? (
            <ErrorState message={`Could not load your recent scans. ${scansError.message}`} onRetry={() => void refetchScans()} />
          ) : scans && scans.length > 0 ? (
            <div className="overflow-hidden rounded-3xl bg-white">
              {scans.map((scan) => {
                const tone = scoreTone(scan.riskScore);
                return (
                  <Link
                    key={scan.id}
                    href={`/scan/${scan.id}`}
                    className="flex items-center gap-4 border-b border-fog px-5 py-4 transition-colors last:border-0 hover:bg-fog/60 focus:outline-none focus-visible:bg-fog md:px-7"
                  >
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog">
                      {scan.inputType === "image" ? <ImageIcon className="h-5 w-5 text-graphite" /> : <Type className="h-5 w-5 text-graphite" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-graphite">{scan.productName || "Unnamed Product"}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(scan.createdAt).toLocaleDateString()} • {scan.inputType === "image" ? "Image Scan" : "Text Entry"}
                      </p>
                    </div>
                    {scan.analysisComplete && scan.riskScore != null && (
                      <div className="flex shrink-0 items-center gap-3">
                        <StatusTag tone={tone.tone} className="max-sm:hidden">{tone.label}</StatusTag>
                        <span className="sr-only">Risk Score:</span>
                        <span className="fn-metric text-2xl text-graphite">{scan.riskScore}</span>
                      </div>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-3xl bg-white px-6 py-14 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-fog">
                <ScanLine className="h-7 w-7 text-ember-orange" />
              </span>
              <p className="mt-4 text-lg font-bold text-graphite">No scans yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">Scan an ingredient label to get your first personalised risk report.</p>
              <Button className="mt-6" asChild><Link href="/scanner">Start Your First Scan</Link></Button>
            </div>
          )}
        </section>

        {!profile && !profileLoading && (
          <div className="flex flex-col gap-5 rounded-3xl bg-white p-6 sm:flex-row sm:items-center sm:justify-between md:p-7">
            <div className="flex items-start gap-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog">
                <User className="h-5 w-5 text-ember-orange" />
              </span>
              <div>
                <p className="text-lg font-bold text-graphite">Complete Your Profile</p>
                <p className="mt-1 text-sm text-muted-foreground">Add your health information for personalized risk analysis</p>
              </div>
            </div>
            <Button className="w-full sm:w-auto" asChild><Link href="/profile">Set Up Profile</Link></Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
