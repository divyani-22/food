import { Button } from "@/components/ui/button";
import { ArrowRight, UserRound } from "lucide-react";
import { Link } from "wouter";

interface ProfileCompletionBannerProps {
  hasProfile: boolean;
}

export function ProfileCompletionBanner({ hasProfile }: ProfileCompletionBannerProps) {
  if (hasProfile) return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-3xl border border-border bg-white p-5 sm:flex-row sm:items-start md:p-6"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-fog" aria-hidden="true">
        <UserRound className="h-5 w-5 text-sunset-orange" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-lg font-bold leading-tight text-graphite">
          Complete Your Profile for Personalized Analysis
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Get personalized health risk assessments by adding your medical conditions, medications, age, diet type, and lifestyle information. Without a profile, you'll receive generic analysis.
        </p>
        <div className="pt-2">
          <Button variant="dark" className="w-full sm:w-auto" asChild>
            <Link href="/profile">
              Complete Profile Now
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
