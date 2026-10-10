import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { FileText, ArrowLeft } from "lucide-react";

export default function TermsOfService() {
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
              <FileText className="h-8 w-8 text-green-600" />
              <CardTitle className="text-3xl">Terms of Service</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Last updated: November 5, 2025
            </p>
          </CardHeader>
          <CardContent className="prose prose-green max-w-none space-y-6">
            <section>
              <h2 className="text-2xl font-semibold mb-3">Agreement to Terms</h2>
              <p>
                By accessing and using Smart Food Risk Analyzer ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Description of Service</h2>
              <p>
                Smart Food Risk Analyzer is an AI-powered platform that analyzes food ingredients to assess potential health risks. The Service provides:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Ingredient scanning via text input or image upload (OCR)</li>
                <li>Personalized health risk analysis based on your profile</li>
                <li>Educational content supporting the Label Padhega India movement</li>
                <li>AI chatbot for food and nutrition questions</li>
                <li>Product alternatives and recommendations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Important Disclaimer</h2>
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-4">
                <p className="font-semibold text-yellow-800">Medical Disclaimer</p>
                <p className="text-yellow-700 mt-2">
                  The Service is for <strong>informational and educational purposes only</strong>. It is NOT a substitute for professional medical advice, diagnosis, or treatment. Always consult with qualified healthcare professionals before making dietary changes, especially if you have medical conditions or take medications.
                </p>
              </div>
              <p>
                Our analysis is based on publicly available data from WHO, FSSAI, and scientific literature. While we strive for accuracy, we cannot guarantee that all information is complete, current, or error-free.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">User Responsibilities</h2>
              <p>By using the Service, you agree to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Provide Accurate Information:</strong> Enter truthful and accurate health information in your profile</li>
                <li><strong>Use Responsibly:</strong> Use the Service as a tool for awareness, not as medical advice</li>
                <li><strong>Verify Information:</strong> Cross-check critical health decisions with healthcare professionals</li>
                <li><strong>Respect Usage Limits:</strong> Do not abuse or overload the Service with excessive requests</li>
                <li><strong>Protect Your Account:</strong> Maintain the confidentiality of your login credentials</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Accuracy and Limitations</h2>
              <p>
                While we use advanced AI and authoritative data sources, our analysis has limitations:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>OCR may misread ingredient labels</li>
                <li>AI analysis is probabilistic and may contain errors</li>
                <li>Ingredient databases may be incomplete or outdated</li>
                <li>Individual health responses vary and cannot be fully predicted</li>
                <li>The Service does not account for all possible drug-food interactions</li>
              </ul>
              <p className="mt-3">
                You acknowledge these limitations and agree to use the Service accordingly.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Intellectual Property</h2>
              <p>
                The Service, including its design, code, content, and AI models, is owned by Smart Food Risk Analyzer and protected by intellectual property laws. You may not:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Copy, modify, or distribute our software or content</li>
                <li>Reverse engineer or extract our AI models</li>
                <li>Use our branding without permission</li>
                <li>Scrape or automatically collect data from the Service</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">User-Generated Content</h2>
              <p>
                When you upload images or enter ingredient data, you grant us a license to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Process and analyze the content</li>
                <li>Store it for your scan history</li>
                <li>Use anonymized data to improve our Service</li>
              </ul>
              <p className="mt-3">
                You represent that you have the right to upload any images you submit and that they do not violate third-party rights.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Prohibited Uses</h2>
              <p>You may not use the Service to:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Violate any laws or regulations</li>
                <li>Harass, abuse, or harm others</li>
                <li>Spread misinformation or false health claims</li>
                <li>Impersonate others or provide false information</li>
                <li>Interfere with the Service's operation or security</li>
                <li>Use the Service for commercial purposes without authorization</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Limitation of Liability</h2>
              <div className="bg-red-50 border-l-4 border-red-400 p-4 my-4">
                <p className="font-semibold text-red-800">Important Legal Notice</p>
                <p className="text-red-700 mt-2">
                  TO THE MAXIMUM EXTENT PERMITTED BY LAW, SMART FOOD RISK ANALYZER SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO HEALTH COMPLICATIONS, ALLERGIC REACTIONS, OR MEDICAL EXPENSES ARISING FROM USE OF THE SERVICE.
                </p>
              </div>
              <p>
                We provide the Service "as is" without warranties of any kind. Your use of the Service is at your own risk.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Account Termination</h2>
              <p>
                We reserve the right to suspend or terminate your account if you:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Violate these Terms of Service</li>
                <li>Engage in fraudulent or abusive behavior</li>
                <li>Pose a security risk to the Service or other users</li>
              </ul>
              <p className="mt-3">
                You may delete your account at any time through your profile settings.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Changes to Terms</h2>
              <p>
                We may modify these Terms of Service at any time. Significant changes will be communicated via email or platform notification. Continued use after changes constitutes acceptance of the updated terms.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Governing Law</h2>
              <p>
                These Terms shall be governed by the laws of India. Any disputes shall be resolved in the courts of [Your Jurisdiction].
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">Contact Information</h2>
              <p>
                For questions about these Terms of Service, please contact us at{" "}
                <a href="https://help.manus.im" target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">
                  https://help.manus.im
                </a>
              </p>
            </section>

            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mt-8">
              <h3 className="text-lg font-semibold mb-2">Label Padhega India 🇮🇳</h3>
              <p className="text-sm">
                By using our Service, you support the Label Padhega India movement for consumer awareness and food transparency. Together, we empower Indians to make informed, healthy choices.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
