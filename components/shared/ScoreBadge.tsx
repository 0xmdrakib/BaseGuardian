// components/shared/ScoreBadge.tsx
"use client";

interface ScoreBadgeProps {
  label: string;
  score: number | null;
}

export function ScoreBadge({ label, score }: ScoreBadgeProps) {
  if (score == null || Number.isNaN(score)) {
    return (
      <span className="inline-flex items-center rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500">
        {label}: N/A
      </span>
    );
  }

  // যদি score 0–1 হয়, ওটাকে percent-এর জন্য convert করব,
  // কিন্তু দেখাব 0.xx হিসেবে
  const isUnitScale = score <= 1.5;
  const percent = isUnitScale ? score * 100 : score;

  let tone =
    "bg-emerald-500/10 text-emerald-300 border-emerald-500/40"; // good
  if (percent < 40) {
    tone = "bg-rose-500/10 text-rose-300 border-rose-500/40";
  } else if (percent < 75) {
    tone = "bg-amber-500/10 text-amber-300 border-amber-500/40";
  }

  const display = isUnitScale
    ? score.toFixed(2) // Neynar score: 0.xx
    : Math.round(score).toString(); // Health score: 0–100

  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium " +
        tone
      }
    >
      <span>{label}</span>
      <span className="opacity-80">{display}</span>
    </span>
  );
}
