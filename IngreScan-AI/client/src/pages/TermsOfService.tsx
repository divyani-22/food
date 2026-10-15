import { PublicPage } from "@/pages/About";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";

const prose = "text-[17px] leading-[1.7] text-graphite";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-border pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-xl font-bold text-graphite md:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className={`list-disc space-y-2 pl-6 marker:text-muted-foreground ${prose}`}>{children}</ul>
  );
}

/** Flat Fog callout: coloured icon carries the tone, text stays graphite. */
function Callout({
  icon: Icon,
  iconClass,
  title,
  children,
}: {
  icon: typeof AlertTriangle;
  iconClass: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-3xl bg-fog p-5 md:p-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white">
        <Icon className={`h-5 w-5 ${iconClass}`} />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-graphite">{title}</p>
        <p className="mt-2 text-[15px] leading-relaxed text-graphite">{children}</p>
      </div>
    </div>
  );
}

export default function TermsOfService() {
  return (
    <PublicPage>
      <header className="mb-12">
        <p className="fn-eyebrow">Legal</p>
        <h1 className="fn-heading mt-3 text-graphite">Terms of Service</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: November 5, 2025</p>
      </header>

      <div className="space-y-10">
        <Section title="Agreement to Terms">
          <p className={prose}>
            By accessing and using Smart Food Risk Analyzer ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
          </p>
        </Section>

        <Section title="Description of Service">
          <p className={prose}>
            Smart Food Risk Analyzer is an AI-powered platform that analyzes food ingredients to assess potential health risks. The Service provides:
          </p>
          <List>
            <li>Ingredient scanning via text input or image upload (OCR)</li>
            <li>Personalized health risk analysis based on your profile</li>
            <li>Educational content supporting the Label Padhega India movement</li>
            <li>AI chatbot for food and nutrition questions</li>
            <li>Product alternatives and recommendations</li>
          </List>
        </Section>

        <Section title="Important Disclaimer">
          <Callout icon={AlertTriangle} iconClass="text-sunset-orange" title="Medical Disclaimer">
            The Service is for <strong>informational and educational purposes only</strong>. It is NOT a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified healthcare professionals before making dietary changes, especially if you have medical conditions or take medications.
          </Callout>
          <p className={prose}>
            Our analysis is based on publicly available data from WHO, FSSAI, and scientific literature. While we strive for accuracy, we cannot guarantee that all information is complete, current, or error-free.
          </p>
        </Section>

        <Section title="User Responsibilities">
          <p className={prose}>By using the Service, you agree to:</p>
          <List>
            <li><strong>Provide Accurate Information:</strong> Enter truthful and accurate health information in your profile</li>
            <li><strong>Use Responsibly:</strong> Use the Service as a tool for awareness, not as medical advice</li>
            <li><strong>Verify Information:</strong> Cross-check critical health decisions with healthcare professionals</li>
            <li><strong>Respect Usage Limits:</strong> Do not abuse or overload the Service with excessive requests</li>
            <li><strong>Protect Your Account:</strong> Maintain the confidentiality of your login credentials</li>
          </List>
        </Section>

        <Section title="Accuracy and Limitations">
          <p className={prose}>
            While we use advanced AI and authoritative data sources, our analysis has limitations:
          </p>
          <List>
            <li>OCR may misread ingredient labels</li>
            <li>AI analysis is probabilistic and may contain errors</li>
            <li>Ingredient databases may be incomplete or outdated</li>
            <li>Individual health responses vary and cannot be fully predicted</li>
            <li>The Service does not account for all possible drug-food interactions</li>
          </List>
          <p className={prose}>
            You acknowledge these limitations and agree to use the Service accordingly.
          </p>
        </Section>

        <Section title="Intellectual Property">
          <p className={prose}>
            The Service, including its design, code, content, and AI models, is owned by Smart Food Risk Analyzer and protected by intellectual property laws. You may not:
          </p>
          <List>
            <li>Copy, modify, or distribute our software or content</li>
            <li>Reverse engineer or extract our AI models</li>
            <li>Use our branding without permission</li>
            <li>Scrape or automatically collect data from the Service</li>
          </List>
        </Section>

        <Section title="User-Generated Content">
          <p className={prose}>
            When you upload images or enter ingredient data, you grant us a license to:
          </p>
          <List>
            <li>Process and analyze the content</li>
            <li>Store it for your scan history</li>
            <li>Use anonymized data to improve our Service</li>
          </List>
          <p className={prose}>
            You represent that you have the right to upload any images you submit and that they do not violate third-party rights.
          </p>
        </Section>

        <Section title="Prohibited Uses">
          <p className={prose}>You may not use the Service to:</p>
          <List>
            <li>Violate any laws or regulations</li>
            <li>Harass, abuse, or harm others</li>
            <li>Spread misinformation or false health claims</li>
            <li>Impersonate others or provide false information</li>
            <li>Interfere with the Service's operation or security</li>
            <li>Use the Service for commercial purposes without authorization</li>
          </List>
        </Section>

        <Section title="Limitation of Liability">
          <Callout icon={ShieldAlert} iconClass="text-signal-red-orange" title="Important Legal Notice">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, SMART FOOD RISK ANALYZER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO HEALTH COMPLICATIONS, ALLERGIC REACTIONS, OR MEDICAL EXPENSES ARISING FROM USE OF THE SERVICE.
          </Callout>
          <p className={prose}>
            We provide the Service "as is" without warranties of any kind. Your use of the Service is at your own risk.
          </p>
        </Section>

        <Section title="Account Termination">
          <p className={prose}>
            We reserve the right to suspend or terminate your account if you:
          </p>
          <List>
            <li>Violate these Terms of Service</li>
            <li>Engage in fraudulent or abusive behavior</li>
            <li>Pose a security risk to the Service or other users</li>
          </List>
          <p className={prose}>
            You may delete your account at any time through your profile settings.
          </p>
        </Section>

        <Section title="Changes to Terms">
          <p className={prose}>
            We may modify these Terms of Service at any time. Significant changes will be communicated via email or platform notification. Continued use after changes constitutes acceptance of the updated terms.
          </p>
        </Section>

        <Section title="Governing Law">
          <p className={prose}>
            These Terms shall be governed by the laws of India. Any disputes shall be resolved in the courts of [Your Jurisdiction].
          </p>
        </Section>

        <Section title="Contact Information">
          <p className={`${prose} break-words`}>
            For questions about these Terms of Service, please contact us at{" "}
            <a
              href="https://help.manus.im"
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-graphite underline decoration-ember-orange decoration-2 underline-offset-4 hover:text-ember-orange"
            >
              https://help.manus.im
            </a>
          </p>
        </Section>

        <aside className="rounded-3xl bg-fog p-6 md:p-8">
          <h3 className="text-lg font-bold text-graphite">Label Padhega India</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            By using our Service, you support the Label Padhega India movement for consumer awareness and food transparency. Together, we empower Indians to make informed, healthy choices.
          </p>
        </aside>
      </div>
    </PublicPage>
  );
}
