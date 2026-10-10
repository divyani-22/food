import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Shield, ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="container max-w-4xl py-12">
        <Link href="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Shield className="h-8 w-8 text-green-600" />
              <CardTitle className="text-3xl">Privacy Policy</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Last updated: November 5, 2025
            </p>
          </CardHeader>
          <CardContent className="prose prose-green max-w-none space-y-6">
            <section>
              <h2 className="text-2xl font-semibold mb-3">Introduction</h2>
              <p>
                Welcome to Smart Food Risk Analyzer. We are committed to protecting your privacy and ensuring the security of your personal health information. This Privacy Policy explains how we collect, use, and safeguard your data when you use our food ingredient analysis platform.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Information We Collect</h2>
              <h3 className="text-xl font-medium mt-4 mb-2">Personal Information</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Email address (for account creation and authentication)</li>
                <li>Name (optional, for personalization)</li>
              </ul>

              <h3 className="text-xl font-medium mt-4 mb-2">Health Information</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Age, gender, height, and weight</li>
                <li>Medical conditions and health history</li>
                <li>Current and past medications</li>
                <li>Exercise frequency and diet type</li>
              </ul>

              <h3 className="text-xl font-medium mt-4 mb-2">Usage Information</h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Food products scanned and ingredients analyzed</li>
                <li>Scan history and analysis results</li>
                <li>Chat conversations with our AI assistant</li>
                <li>Images uploaded for OCR processing</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">How We Use Your Information</h2>
              <p>We use your information to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Provide Personalized Analysis:</strong> Your health profile helps us assess ingredient risks specific to your conditions and medications</li>
                <li><strong>Generate Recommendations:</strong> Suggest safer product alternatives based on your dietary preferences and health needs</li>
                <li><strong>Improve Our Service:</strong> Analyze usage patterns to enhance our AI models and user experience</li>
                <li><strong>Support Label Padhega India:</strong> Contribute to consumer awareness initiatives while maintaining your anonymity</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Data Security</h2>
              <p>
                We implement industry-standard security measures to protect your personal and health information:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>All data is encrypted in transit and at rest</li>
                <li>Secure authentication via Manus OAuth platform</li>
                <li>Regular security audits and updates</li>
                <li>Access controls and monitoring</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Data Sharing</h2>
              <p>
                We <strong>do not sell</strong> your personal or health information to third parties. We may share anonymized, aggregated data for:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Public health research and consumer awareness initiatives</li>
                <li>Supporting the Label Padhega India movement</li>
                <li>Improving food safety standards in India</li>
              </ul>
              <p className="mt-3">
                We may share your information with:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Service Providers:</strong> Third-party services that help us operate our platform (hosting, analytics, AI processing)</li>
                <li><strong>Legal Requirements:</strong> When required by law or to protect our rights and users' safety</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Your Rights</h2>
              <p>You have the right to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Access:</strong> Request a copy of your personal data</li>
                <li><strong>Correction:</strong> Update or correct your information through your profile page</li>
                <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
                <li><strong>Export:</strong> Download your scan history and analysis results</li>
                <li><strong>Opt-out:</strong> Withdraw consent for data processing (may limit service functionality)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Data Retention</h2>
              <p>
                We retain your information for as long as your account is active or as needed to provide services. You can request deletion at any time. Anonymized data may be retained for research and improvement purposes.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Children's Privacy</h2>
              <p>
                Our service is not intended for children under 13. We do not knowingly collect information from children. If you believe a child has provided us with personal information, please contact us immediately.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Changes to This Policy</h2>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of significant changes via email or through the platform. Continued use of our service after changes constitutes acceptance of the updated policy.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Contact Us</h2>
              <p>
                If you have questions about this Privacy Policy or wish to exercise your rights, please contact us through the platform's support system or visit{" "}
                <a href="https://help.manus.im" target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">
                  https://help.manus.im
                </a>
              </p>
            </section>

            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mt-8">
              <h3 className="text-lg font-semibold mb-2">Supporting Label Padhega India 🇮🇳</h3>
              <p className="text-sm">
                By using our platform, you contribute to the Label Padhega India movement for consumer awareness and food transparency. Together, we're empowering Indians to make informed, healthy choices.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
