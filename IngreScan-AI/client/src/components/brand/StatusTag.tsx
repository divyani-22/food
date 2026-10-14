import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type Tone = "positive" | "caution" | "negative" | "severe" | "info" | "brand" | "plum" | "iris" | "neutral";

/** Fog pill with a colored dot and graphite text — color carries meaning, text stays readable. */
export function StatusTag({
  tone = "neutral",
  children,
  onWhite = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  onWhite?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("fn-tag", onWhite && "bg-white", className)} data-tone={tone}>
      {children}
    </span>
  );
}

/** Map ingredient risk levels to brand data colors. */
export function riskTone(level?: string | null): Tone {
  switch ((level ?? "").toLowerCase()) {
    case "safe":
      return "positive";
    case "low":
      return "info";
    case "moderate":
      return "caution";
    case "high":
      return "negative";
    case "severe":
      return "severe";
    default:
      return "neutral";
  }
}

/** Map an overall 0–100 risk score to a tone and label. */
export function scoreTone(score?: number | null): { tone: Tone; label: string } {
  if (score == null) return { tone: "neutral", label: "Not scored" };
  if (score < 30) return { tone: "positive", label: "Low risk" };
  if (score < 60) return { tone: "caution", label: "Moderate risk" };
  return { tone: "negative", label: "High risk" };
}
