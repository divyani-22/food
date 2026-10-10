import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Info, ArrowLeft, Heart, Users, Shield, Lightbulb } from "lucide-react";

export default function About() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white">
      <div className="container max-w-4xl py-12">
        <Link href="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center gap-3">
              <Info className="h-8 w-8 text-green-600" />
              <CardTitle className="text-3xl">About Smart Food Risk Analyzer</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <section>
              <h2 className="text-2xl font-semibold mb-3">Our Mission</h2>
              <p className="text-lg leading-relaxed">
                Smart Food Risk Analyzer empowers Indian consumers to make informed, healthy food choices by providing AI-powered ingredient analysis and personalized health risk assessments. We believe that everyone deserves to know what's in their food and how it affects their health.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">What We Do</h2>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="flex gap-3 p-4 bg-green-50 rounded-lg">
                  <Shield className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Ingredient Analysis</h3>
                    <p className="text-sm text-muted-foreground">
                      Scan product labels via text or image and get detailed breakdowns of every ingredient, including hidden sugars, excessive salt, and harmful additives.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 bg-green-50 rounded-lg">
                  <Heart className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Personalized Risk Assessment</h3>
                    <p className="text-sm text-muted-foreground">
                      Get health risk scores tailored to your medical conditions, medications, age, diet type, and lifestyle.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 bg-green-50 rounded-lg">
                  <Lightbulb className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">Healthier Alternatives</h3>
                    <p className="text-sm text-muted-foreground">
                      Discover safer product options with scientific justification from WHO, FSSAI, and peer-reviewed research.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3 p-4 bg-green-50 rounded-lg">
                  <Users className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold mb-1">AI Chatbot Assistant</h3>
                    <p className="text-sm text-muted-foreground">
                      Ask questions about ingredients, health impacts, and nutrition to make better-informed decisions.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </CardContent>
        </Card>

        <Card className="mb-6 border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-white">
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <span className="text-2xl">🇮🇳</span>
              Supporting Label Padhega India
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-lg leading-relaxed">
              We proudly support the <strong>Label Padhega India</strong> movement, a consumer awareness campaign initiated by health influencer Revant Himatsingka (@foodpharmer) to promote food literacy across India.
            </p>

            <div className="bg-white rounded-lg p-5 border border-orange-200">
              <h3 className="font-semibold text-lg mb-3">What is Label Padhega India?</h3>
              <p className="mb-3">
                Label Padhega India is a social movement that educates Indian consumers to read and understand food labels, empowering them to make healthier choices. The campaign focuses on:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">•</span>
                  <span><strong>Exposing hidden ingredients</strong> like maltodextrin, corn syrup, and excessive sugars disguised by misleading marketing</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">•</span>
                  <span><strong>Advocating for transparency</strong> in the food industry and clearer labeling regulations</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">•</span>
                  <span><strong>Protecting children</strong> from unhealthy products marketed as "healthy" or "nutritious"</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">•</span>
                  <span><strong>Encouraging companies</strong> to reformulate products with healthier, cleaner ingredients</span>
                </li>
              </ul>
            </div>

            <div className="bg-white rounded-lg p-5 border border-orange-200">
              <h3 className="font-semibold text-lg mb-3">How We Support the Movement</h3>
              <p className="mb-3">
                Our platform directly contributes to the Label Padhega India mission by:
              </p>
              <ul className="space-y-2 ml-4">
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Identifying and flagging <strong>hidden sugars</strong> (maltodextrin, liquid glucose, corn syrup)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Detecting <strong>misleading claims</strong> on product packaging</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Providing <strong>educational content</strong> about ingredient order and quantity</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Highlighting risks in <strong>children's products</strong> (cereals, health drinks, snacks)</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 font-bold">✓</span>
                  <span>Empowering consumers with <strong>scientific evidence</strong> from WHO, FSSAI, and research</span>
                </li>
              </ul>
            </div>

            <div className="bg-gradient-to-r from-orange-100 to-green-100 rounded-lg p-5 border border-orange-300">
              <p className="text-center font-semibold text-lg">
                "When India reads labels, India makes healthier choices."
              </p>
              <p className="text-center text-sm text-muted-foreground mt-2">
                — Label Padhega India Movement
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Our Technology</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="leading-relaxed">
              We combine cutting-edge AI technology with authoritative health data to provide accurate, personalized analysis:
            </p>
            <ul className="space-y-3 ml-4">
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">•</span>
                <span><strong>AI-Powered Analysis:</strong> Advanced language models analyze ingredients and cross-reference with health databases</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">•</span>
                <span><strong>OCR Technology:</strong> Extract ingredients from product label photos automatically</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">•</span>
                <span><strong>Authoritative Data Sources:</strong> WHO Food Safety guidelines, FSSAI standards, and PubMed research</span>
              </li>
              <li className="flex gap-2">
                <span className="text-green-600 font-bold">•</span>
                <span><strong>Personalization Engine:</strong> Matches ingredient risks with your unique health profile</span>
              </li>
            </ul>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-5 mt-6">
              <h3 className="font-semibold mb-2">Important Disclaimer</h3>
              <p className="text-sm text-muted-foreground">
                Smart Food Risk Analyzer is for <strong>informational and educational purposes only</strong>. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult healthcare professionals before making dietary changes, especially if you have medical conditions or take medications.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="mt-8 text-center">
          <Link href="/scanner">
            <Button size="lg" className="bg-green-600 hover:bg-green-700">
              Start Analyzing Food Products
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
