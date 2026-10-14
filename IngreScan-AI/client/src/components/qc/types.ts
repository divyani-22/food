import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import type { Tone } from "@/components/brand/StatusTag";

type Out = inferRouterOutputs<AppRouter>;
export type QcSummary = Out["qc"]["gradeBatch"]["summary"];
export type QcScorecard = Out["qc"]["scorecard"];
export type QcListItem = Out["qc"]["list"][number];

export type Grade = "A" | "B" | "REVIEW" | "REJECT";
export type Verdict = "ACCEPT" | "ACCEPT_WITH_DISCOUNT" | "REJECT_LOT" | "INSPECT";

export interface ResultPhoto {
  label: string;
  fruit: string;
  freshness: string | null;
  pFresh: number | null;
  confidence: number | null;
  grade: Grade;
  reasons: string[];
  thumb?: string;
}

export const GRADES: Grade[] = ["A", "B", "REVIEW", "REJECT"];

export const GRADE_META: Record<Grade, { label: string; tone: Tone; bar: string; hint: string }> = {
  A: { label: "Grade A", tone: "positive", bar: "bg-verdant-green", hint: "Fresh, high confidence" },
  B: { label: "Grade B", tone: "info", bar: "bg-sky-blue", hint: "Acceptable, not top fresh" },
  REVIEW: { label: "Review", tone: "caution", bar: "bg-sunset-orange", hint: "Classifier unsure, inspect" },
  REJECT: { label: "Reject", tone: "negative", bar: "bg-signal-red-orange", hint: "Rotten or very low freshness" },
};

export const VERDICT_META: Record<Verdict, { label: string; tone: Tone; description: string }> = {
  ACCEPT: { label: "Accept", tone: "positive", description: "The lot meets the acceptance rule." },
  ACCEPT_WITH_DISCOUNT: { label: "Accept with discount", tone: "caution", description: "Usable, but quality is below the full-price rule." },
  REJECT_LOT: { label: "Reject lot", tone: "negative", description: "Too many rejected photos to accept the lot." },
  INSPECT: { label: "Inspect manually", tone: "caution", description: "The result is not clear enough to decide automatically." },
};

export function fruitLabel(code: string): string {
  return code.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function triggerDownload(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
