import { useAuth } from "@/_core/hooks/useAuth";
import { BrandMark } from "@/components/brand/BrandMark";
import {
  FridgeScreen,
  PhoneMockup,
  ProduceScreen,
  ProductScreen,
  ScanResultScreen,
} from "@/components/brand/PhoneMockup";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import {
  ArrowRight,
  Barcode,
  Check,
  FileText,
  MessageSquare,
  Refrigerator,
  ScanLine,
  Shield,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "wouter";

type Pillar = {
  id: string;
  eyebrow: string;
  accent: string;
  rest: string;
  accentClass: string;
  body: string;
  points: string[];
  href: string;
  cta: string;
  screen: ReactNode;
};

const pillars: Pillar[] = [
  {
    id: "scanner",
    eyebrow: "Smart Scanner",
    accent: "Read the label",
    rest: "in seconds, not minutes",
    accentClass: "text-ember-orange",
    body: "Upload ingredient labels or enter text manually. Our OCR technology extracts ingredients instantly, then rates every one against your health profile.",
    points: [
      "Photo or typed ingredient lists",
      "Personalised risk score from 0 to 100",
      "Short and long-term effects, with sources",
    ],
    href: "/scanner",
    cta: "Scan packaged food",
    screen: <ScanResultScreen />,
  },
  {
    id: "produce",
    eyebrow: "Fresh Produce AI",
    accent: "Spot spoilage",
    rest: "before it reaches your plate",
    accentClass: "text-verdant-green",
    body: "Inspect fruit and vegetable freshness with the FreshGuard PyTorch model. Snap a photo and get a freshness score, shelf life and storage tips.",
    points: [
      "Fresh, normal or rotten in one photo",
      "Estimated shelf life for 10 kinds of produce",
      "Save results straight to your pantry",
    ],
    href: "/produce",
    cta: "Inspect fresh produce",
    screen: <ProduceScreen />,
  },
  {
    id: "fridge",
    eyebrow: "Food Expiry Tracker",
    accent: "Waste less",
    rest: "with a fridge that counts down for you",
    accentClass: "text-verdant-green",
    body: "Keep track of your fridge and pantry inventory. Dynamic shelf-life counters alert you before items expire.",
    points: [
      "Fridge, freezer and pantry in one list",
      "Expiring-soon and expired at a glance",
      "Quick expiry presets for common foods",
    ],
    href: "/fridge",
    cta: "Open expiry tracker",
    screen: <FridgeScreen />,
  },
  {
    id: "openfoodfacts",
    eyebrow: "Open Food Facts & Barcode",
    accent: "Look up",
    rest: "millions of packaged foods",
    accentClass: "text-ember-orange",
    body: "Search Open Food Facts by name or barcode. View Nutri-Scores, NOVA ultra-processing grades and allergens, then add products to your fridge.",
    points: [
      "Nutri-Score A–E and NOVA 1–4",
      "Allergens and nutrients per 100 g",
      "One tap to analyse ingredients",
    ],
    href: "/openfoodfacts",
    cta: "Search products",
    screen: <ProductScreen />,
  },
];

const moreFeatures = [
  {
    icon: Shield,
    title: "Risk Analysis",
    description: "Get personalized health risk scores based on your profile, medical conditions, and dietary preferences.",
  },
  {
    icon: MessageSquare,
    title: "AI Chatbot",
    description: "Ask questions about ingredients, health impacts, and get safer alternatives with scientific backing.",
  },
  {
    icon: User,
    title: "Personal Profile",
    description: "Track your health data, medical conditions, and medications for accurate risk assessment.",
  },
  {
    icon: TrendingUp,
    title: "Visual Analytics",
    description: "Interactive charts and graphs show ingredient breakdowns and risk levels at a glance.",
  },
  {
    icon: FileText,
    title: "Scan History",
    description: "Access all your previous scans and reports anytime. Track your food choices over time.",
  },
  {
    icon: Refrigerator,
    title: "Pantry sync",
    description: "Produce you inspect and products you look up can be saved to your expiry tracker in one tap.",
  },
];

const steps = [
  { title: "Scan or Enter", body: "Take a photo of the ingredient label or type ingredients manually" },
  { title: "AI Analysis", body: "Our AI analyzes each ingredient against health databases and your profile" },
  { title: "Get Insights", body: "Receive detailed risk scores, health impacts, and safer alternatives" },
];

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
        <div className="container flex h-16 items-center justify-between gap-4 md:h-[72px]">
          <Link href="/" className="inline-flex h-11 items-center rounded-xl">
            <BrandMark />
          </Link>
          <nav className="hidden items-center gap-8 text-[15px] font-semibold text-graphite lg:flex" aria-label="Sections">
            <a href="#features" className="hover:text-ember-orange">Features</a>
            <a href="#how" className="hover:text-ember-orange">How it works</a>
            <Link href="/about" className="hover:text-ember-orange">About</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="hidden gap-2 md:inline-flex" asChild><Link href="/produce">
                <Sparkles className="h-4 w-4 text-verdant-green" />
                Fresh Produce AI
              </Link></Button>
            <Button className="gap-2 max-sm:px-4" asChild><Link href="/scanner">
                <ScanLine className="h-4 w-4" />
                <span className="sm:hidden">Scan</span>
                <span className="hidden sm:inline">Packaged Scanner</span>
              </Link></Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="flex-1">
        {/* Hero */}
        <section className="overflow-hidden pt-12 md:pt-20">
          <div className="container">
            <div className="mx-auto max-w-3xl text-center">
              <span className="fn-tag" data-tone="brand">Supporting the Label Padhega India movement</span>
              <h1 className="fn-display mt-6 text-graphite">
                <span className="text-verdant-green">Know</span> what you eat
              </h1>
              <p className="fn-subheading mx-auto mt-5 max-w-2xl text-muted-foreground">
                All-in-one food intelligence: inspect fresh produce with{" "}
                <strong className="font-bold text-graphite">FreshGuard PyTorch AI</strong> and analyze packaged food
                ingredients with <strong className="font-bold text-graphite">IngreScan-AI</strong>.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <Button size="lg" className="w-full sm:w-auto" asChild><Link href="/scanner">
                    <ScanLine className="h-5 w-5" />
                    Scan Packaged Food
                  </Link></Button>
                <Button size="lg" variant="dark" className="w-full sm:w-auto" asChild><Link href="/produce">
                    <Sparkles className="h-5 w-5" />
                    Inspect Fresh Produce
                  </Link></Button>
              </div>
              <Link
                href="/dashboard"
                className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-bold text-graphite underline decoration-ember-orange decoration-2 underline-offset-4 hover:text-ember-orange"
              >
                Open Dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Phone fan */}
            <div className="relative mx-auto mt-14 flex h-[330px] max-w-4xl items-start justify-center sm:h-[420px] md:mt-16 lg:h-[470px]">
              <PhoneMockup className="absolute left-1/2 top-10 -translate-x-[118%] -rotate-[7deg] sm:-translate-x-[122%]">
                <ProduceScreen />
              </PhoneMockup>
              <PhoneMockup className="absolute left-1/2 top-10 translate-x-[18%] rotate-[7deg] sm:translate-x-[22%]">
                <FridgeScreen />
              </PhoneMockup>
              <PhoneMockup className="absolute left-1/2 top-0 z-10 -translate-x-1/2">
                <ScanResultScreen />
              </PhoneMockup>
            </div>
          </div>
        </section>

        {/* Feature pillars */}
        <section id="features" className="scroll-mt-20 border-t border-border">
          <div className="container fn-section space-y-20 md:space-y-28">
            <div className="mx-auto max-w-2xl text-center">
              <p className="fn-eyebrow">Comprehensive Food Analysis</p>
              <h2 className="fn-heading mt-3 text-graphite">
                Four tools, <span className="text-ember-orange">one kitchen</span>
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                Our platform combines cutting-edge technology with trusted health data to give you complete insights into your food.
              </p>
            </div>

            {pillars.map((p, i) => (
              <article
                key={p.id}
                className="grid items-center gap-10 md:grid-cols-2 md:gap-16"
              >
                <div className={i % 2 === 1 ? "md:order-2" : ""}>
                  <p className="fn-eyebrow">{p.eyebrow}</p>
                  <h3 className="fn-heading mt-3 text-graphite">
                    <span className={p.accentClass}>{p.accent}</span> {p.rest}
                  </h3>
                  <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">{p.body}</p>
                  <ul className="mt-6 space-y-3">
                    {p.points.map(pt => (
                      <li key={pt} className="flex items-start gap-3 text-[15px] font-semibold text-graphite">
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fog">
                          <Check className="h-3 w-3 text-verdant-green" strokeWidth={3.5} />
                        </span>
                        {pt}
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" className="mt-8" asChild><Link href={p.href}>
                      {p.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link></Button>
                </div>
                <div className={i % 2 === 1 ? "md:order-1" : ""}>
                  <div className="fn-surface flex h-[360px] justify-center overflow-hidden px-6 pt-10 sm:h-[420px] md:pt-14 lg:h-[460px]">
                    <PhoneMockup>
                      {p.screen}
                    </PhoneMockup>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* Everything else — divided list, not a card grid */}
        <section className="bg-fog">
          <div className="container fn-section">
            <div className="max-w-2xl">
              <p className="fn-eyebrow">And everything around it</p>
              <h2 className="fn-heading mt-3 text-graphite">Built around your health profile</h2>
            </div>
            <div className="mt-12 grid gap-x-12 sm:grid-cols-2 lg:grid-cols-3">
              {moreFeatures.map(f => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="flex gap-4 border-t border-[#e4e4e4] py-7">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white">
                      <Icon className="h-5 w-5 text-ember-orange" />
                    </span>
                    <div>
                      <h3 className="text-lg font-bold text-graphite">{f.title}</h3>
                      <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{f.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-20">
          <div className="container fn-section">
            <div className="mx-auto max-w-2xl text-center">
              <p className="fn-eyebrow">Simple, fast, and accurate</p>
              <h2 className="fn-heading mt-3 text-graphite">How It Works</h2>
            </div>
            <ol className="mx-auto mt-12 grid max-w-5xl gap-10 md:grid-cols-3 md:gap-8">
              {steps.map((s, i) => (
                <li key={s.title} className="relative">
                  <div className="flex items-center gap-4">
                    <span className="fn-metric grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ember-orange text-2xl text-white">
                      {i + 1}
                    </span>
                    {i < steps.length - 1 && <span className="hidden h-px flex-1 bg-border md:block" aria-hidden="true" />}
                  </div>
                  <h3 className="mt-5 text-[22px] font-bold text-graphite">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* CTA card */}
        <section className="pb-16 md:pb-24">
          <div className="container">
            <div className="fn-surface flex flex-col items-start gap-6 p-8 md:flex-row md:items-center md:justify-between md:p-12">
              <div className="max-w-xl">
                <h2 className="fn-heading text-graphite">
                  <span className="text-verdant-green">Start making healthier choices</span> today
                </h2>
                <p className="mt-3 text-[17px] leading-relaxed text-muted-foreground">
                  Join thousands of users who are taking control of their health through informed food decisions.
                </p>
              </div>
              {isAuthenticated ? (
                <Button size="lg" className="shrink-0" asChild><Link href="/dashboard">
                    Open Dashboard
                    <ArrowRight className="h-5 w-5" />
                  </Link></Button>
              ) : (
                <Button size="lg" className="shrink-0" asChild>
                  <a href={getLoginUrl()}>
                    Sign Up Now - It's Free
                    <ArrowRight className="h-5 w-5" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="container flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <BrandMark size="sm" />
            <p className="text-sm text-muted-foreground">
              © 2025 Smart Food Risk Analyzer. Supporting Label Padhega India.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 text-[15px] font-semibold text-graphite" aria-label="Footer">
            <Link href="/about" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-ember-orange">About</Link>
            <Link href="/privacy" className="inline-flex min-h-11 items-center hover:text-ember-orange">Privacy Policy</Link>
            <Link href="/terms" className="inline-flex min-h-11 items-center hover:text-ember-orange">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
