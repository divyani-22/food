import { PublicPage } from "@/pages/About";
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

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="pt-2 text-lg font-bold text-graphite">{children}</h3>;
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className={`list-disc space-y-2 pl-6 marker:text-muted-foreground ${prose}`}>{children}</ul>
  );
}

export default function PrivacyPolicy() {
  return (
    <PublicPage>
      <header className="mb-12">
        <p className="fn-eyebrow">Legal</p>
        <h1 className="fn-heading mt-3 text-graphite">Privacy Policy</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: November 5, 2025</p>
      </header>

      <div className="space-y-10">
        <Section title="Introduction">
          <p className={prose}>
            Welcome to Smart Food Risk Analyzer. We are committed to protecting your privacy and ensuring the security of your personal health information. This Privacy Policy explains how we collect, use, and safeguard your data when you use our food ingredient analysis platform.
          </p>
        </Section>

        <Section title="Information We Collect">
          <SubHeading>Personal Information</SubHeading>
          <List>
            <li>Email address (for account creation and authentication)</li>
            <li>Name (optional, for personalization)</li>
          </List>

          <SubHeading>Health Information</SubHeading>
          <List>
            <li>Age, gender, height, and weight</li>
            <li>Medical conditions and health history</li>
            <li>Current and past medications</li>
            <li>Exercise frequency and diet type</li>
          </List>

          <SubHeading>Usage Information</SubHeading>
          <List>
            <li>Food products scanned and ingredients analyzed</li>
            <li>Scan history and analysis results</li>
            <li>Chat conversations with our AI assistant</li>
            <li>Images uploaded for OCR processing</li>
          </List>
        </Section>

        <Section title="How We Use Your Information">
          <p className={prose}>We use your information to:</p>
          <List>
            <li><strong>Provide Personalized Analysis:</strong> Your health profile helps us assess ingredient risks specific to your conditions and medications</li>
            <li><strong>Generate Recommendations:</strong> Suggest safer product alternatives based on your dietary preferences and health needs</li>
            <li><strong>Improve Our Service:</strong> Analyze usage patterns to enhance our AI models and user experience</li>
            <li><strong>Support Label Padhega India:</strong> Contribute to consumer awareness initiatives while maintaining your anonymity</li>
          </List>
        </Section>

        <Section title="Data Security">
          <p className={prose}>
            We implement industry-standard security measures to protect your personal and health information:
          </p>
          <List>
            <li>All data is encrypted in transit and at rest</li>
            <li>Secure authentication via Manus OAuth platform</li>
            <li>Regular security audits and updates</li>
            <li>Access controls and monitoring</li>
          </List>
        </Section>

        <Section title="Data Sharing">
          <p className={prose}>
            We <strong>do not sell</strong> your personal or health information to third parties. We may share anonymized, aggregated data for:
          </p>
          <List>
            <li>Public health research and consumer awareness initiatives</li>
            <li>Supporting the Label Padhega India movement</li>
            <li>Improving food safety standards in India</li>
          </List>
          <p className={prose}>We may share your information with:</p>
          <List>
            <li><strong>Service Providers:</strong> Third-party services that help us operate our platform (hosting, analytics, AI processing)</li>
            <li><strong>Legal Requirements:</strong> When required by law or to protect our rights and users' safety</li>
          </List>
        </Section>

        <Section title="Your Rights">
          <p className={prose}>You have the right to:</p>
          <List>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Correction:</strong> Update or correct your information through your profile page</li>
            <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
            <li><strong>Export:</strong> Download your scan history and analysis results</li>
            <li><strong>Opt-out:</strong> Withdraw consent for data processing (may limit service functionality)</li>
          </List>
        </Section>

        <Section title="Data Retention">
          <p className={prose}>
            We retain your information for as long as your account is active or as needed to provide services. You can request deletion at any time. Anonymized data may be retained for research and improvement purposes.
          </p>
        </Section>

        <Section title="Children's Privacy">
          <p className={prose}>
            Our service is not intended for children under 13. We do not knowingly collect information from children. If you believe a child has provided us with personal information, please contact us immediately.
          </p>
        </Section>

        <Section title="Changes to This Policy">
          <p className={prose}>
            We may update this Privacy Policy from time to time. We will notify you of significant changes via email or through the platform. Continued use of our service after changes constitutes acceptance of the updated policy.
          </p>
        </Section>

        <Section title="Contact Us">
          <p className={`${prose} break-words`}>
            If you have questions about this Privacy Policy or wish to exercise your rights, please contact us through the platform's support system or visit{" "}
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
          <h3 className="text-lg font-bold text-graphite">Supporting Label Padhega India</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            By using our platform, you contribute to the Label Padhega India movement for consumer awareness and food transparency. Together, we're empowering Indians to make informed, healthy choices.
          </p>
        </aside>
      </div>
    </PublicPage>
  );
}
