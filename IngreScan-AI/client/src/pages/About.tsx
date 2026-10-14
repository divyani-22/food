import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Heart, Info, Lightbulb, Quote, Shield, Users } from "lucide-react";

/* ---------- Public page chrome (shared by About / Privacy / Terms) ---------- */

export function PublicTopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6 md:px-10">
        <Link
          href="/"
          aria-label="Home"
          className="min-w-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <BrandMark />
        </Link>
        <Button asChild variant="ghost" className="shrink-0">
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to Home</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between md:px-10">
        <div className="space-y-3">
          <Link
            href="/"
            aria-label="Home"
            className="inline-flex rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark size="sm" />
          </Link>
          <p className="text-sm text-muted-foreground">
            © 2025 Smart Food Risk Analyzer. Supporting Label Padhega India.
          </p>
        </div>
        <nav className="-mx-3 flex flex-wrap text-sm font-bold" aria-label="Footer">
          {[
            ["/about", "About"],
            ["/privacy", "Privacy Policy"],
            ["/terms", "Terms of Service"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center rounded-3xl px-3 text-graphite transition-colors hover:text-ember-orange focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/** White canvas page with top bar + footer, content in a readable column. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-white text-graphite">
      <PublicTopBar />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-12 sm:px-6 md:pb-24 md:pt-16">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

/* ---------- About ---------- */

const prose = "text-[17px] leading-[1.7] text-graphite";

function Bullet({ children, check = false }: { children: ReactNode; check?: boolean }) {
  return (
    <li className="flex gap-3">
      {check ? (
        <Check className="mt-1.5 h-4 w-4 shrink-0 text-verdant-green" strokeWidth={3} aria-hidden="true" />
      ) : (
        <span className="mt-[0.7em] h-1.5 w-1.5 shrink-0 rounded-full bg-ember-orange" aria-hidden="true" />
      )}
      <span>{children}</span>
    </li>
  );
}

const features = [
  {
    icon: Shield,
    title: "Ingredient Analysis",
    body: "Scan product labels via text or image and get detailed breakdowns of every ingredient, including hidden sugars, excessive salt, and harmful additives.",
  },
  {
    icon: Heart,
    title: "Personalized Risk Assessment",
    body: "Get health risk scores tailored to your medical conditions, medications, age, diet type, and lifestyle.",
  },
  {
    icon: Lightbulb,
    title: "Healthier Alternatives",
    body: "Discover safer product options with scientific justification from WHO, FSSAI, and peer-reviewed research.",
  },
  {
    icon: Users,
    title: "AI Chatbot Assistant",
    body: "Ask questions about ingredients, health impacts, and nutrition to make better-informed decisions.",
  },
];

export default function About() {
  return (
    <PublicPage>
      {/* Hero */}
      <section>
        <p className="fn-eyebrow">About Smart Food Risk Analyzer</p>
        <h1 className="fn-heading mt-3 text-graphite">
          Everyone deserves to know <span className="text-verdant-green">what's in their food.</span>
        </h1>
        <h2 className="mt-10 text-xl font-bold text-graphite">Our Mission</h2>
        <p className={`mt-3 ${prose}`}>
          Smart Food Risk Analyzer empowers Indian consumers to make informed, healthy food choices by providing AI-powered ingredient analysis and personalized health risk assessments. We believe that everyone deserves to know what's in their food and how it affects their health.
        </p>
      </section>

      {/* What we do */}
      <section className="mt-16 md:mt-20">
        <h2 className="fn-heading text-graphite">What We Do</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {features.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-3xl bg-fog p-6">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white">
                <Icon className="h-5 w-5 text-ember-orange" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-graphite">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Label Padhega India */}
      <section className="mt-16 md:mt-20">
        <h2 className="fn-heading text-graphite">Supporting Label Padhega India</h2>
        <p className={`mt-4 ${prose}`}>
          We proudly support the <strong>Label Padhega India</strong> movement, a consumer awareness campaign initiated by health influencer Revant Himatsingka (@foodpharmer) to promote food literacy across India.
        </p>

        <h3 className="mt-10 text-xl font-bold text-graphite">What is Label Padhega India?</h3>
        <p className={`mt-3 ${prose}`}>
          Label Padhega India is a social movement that educates Indian consumers to read and understand food labels, empowering them to make healthier choices. The campaign focuses on:
        </p>
        <ul className={`mt-4 space-y-3 ${prose}`}>
          <Bullet><strong>Exposing hidden ingredients</strong> like maltodextrin, corn syrup, and excessive sugars disguised by misleading marketing</Bullet>
          <Bullet><strong>Advocating for transparency</strong> in the food industry and clearer labeling regulations</Bullet>
          <Bullet><strong>Protecting children</strong> from unhealthy products marketed as "healthy" or "nutritious"</Bullet>
          <Bullet><strong>Encouraging companies</strong> to reformulate products with healthier, cleaner ingredients</Bullet>
        </ul>

        <div className="mt-10 rounded-3xl bg-fog p-6 md:p-8">
          <h3 className="text-xl font-bold text-graphite">How We Support the Movement</h3>
          <p className={`mt-3 ${prose}`}>Our platform directly contributes to the Label Padhega India mission by:</p>
          <ul className={`mt-4 space-y-3 ${prose}`}>
            <Bullet check>Identifying and flagging <strong>hidden sugars</strong> (maltodextrin, liquid glucose, corn syrup)</Bullet>
            <Bullet check>Detecting <strong>misleading claims</strong> on product packaging</Bullet>
            <Bullet check>Providing <strong>educational content</strong> about ingredient order and quantity</Bullet>
            <Bullet check>Highlighting risks in <strong>children's products</strong> (cereals, health drinks, snacks)</Bullet>
            <Bullet check>Empowering consumers with <strong>scientific evidence</strong> from WHO, FSSAI, and research</Bullet>
          </ul>
        </div>

        <figure className="mt-10 border-l-4 border-ember-orange pl-5 md:pl-6">
          <Quote className="h-6 w-6 text-ember-orange" aria-hidden="true" />
          <blockquote className="mt-2 text-xl font-bold leading-snug text-graphite md:text-2xl">
            "When India reads labels, India makes healthier choices."
          </blockquote>
          <figcaption className="mt-3 text-sm text-muted-foreground">— Label Padhega India Movement</figcaption>
        </figure>
      </section>

      {/* Technology */}
      <section className="mt-16 md:mt-20">
        <h2 className="fn-heading text-graphite">Our Technology</h2>
        <p className={`mt-4 ${prose}`}>
          We combine cutting-edge AI technology with authoritative health data to provide accurate, personalized analysis:
        </p>
        <ul className={`mt-4 space-y-3 ${prose}`}>
          <Bullet><strong>AI-Powered Analysis:</strong> Advanced language models analyze ingredients and cross-reference with health databases</Bullet>
          <Bullet><strong>OCR Technology:</strong> Extract ingredients from product label photos automatically</Bullet>
          <Bullet><strong>Authoritative Data Sources:</strong> WHO Food Safety guidelines, FSSAI standards, and PubMed research</Bullet>
          <Bullet><strong>Personalization Engine:</strong> Matches ingredient risks with your unique health profile</Bullet>
        </ul>

        <div className="mt-8 flex gap-4 rounded-3xl bg-fog p-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white">
            <Info className="h-5 w-5 text-graphite" />
          </span>
          <div>
            <h3 className="font-bold text-graphite">Important Disclaimer</h3>
            <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
              Smart Food Risk Analyzer is for <strong className="text-graphite">informational and educational purposes only</strong>. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult healthcare professionals before making dietary changes, especially if you have medical conditions or take medications.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-14 flex justify-center">
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/scanner">
            Start Analyzing Food Products
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </PublicPage>
  );
}
