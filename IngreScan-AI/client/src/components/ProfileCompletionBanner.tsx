import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { Link } from "wouter";

interface ProfileCompletionBannerProps {
  hasProfile: boolean;
}

export function ProfileCompletionBanner({ hasProfile }: ProfileCompletionBannerProps) {
  if (hasProfile) return null;

  return (
    <Alert className="mb-6 border-orange-300 bg-orange-50">
      <AlertCircle className="h-5 w-5 text-orange-600" />
      <AlertTitle className="text-orange-900 font-semibold">
        Complete Your Profile for Personalized Analysis
      </AlertTitle>
      <AlertDescription className="text-orange-800 mt-2">
        <p className="mb-3">
          Get personalized health risk assessments by adding your medical conditions, medications, age, diet type, and lifestyle information. Without a profile, you'll receive generic analysis.
        </p>
        <Button variant="default" size="sm" className="bg-orange-600 hover:bg-orange-700" asChild>
          <Link href="/profile">
            Complete Profile Now
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
