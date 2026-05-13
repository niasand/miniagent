import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

type BadgeTone = "default" | "green" | "amber" | "blue" | "red";

const toneClass: Record<BadgeTone, string> = {
  default: "border-border bg-surface text-foreground",
  green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  blue: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  red: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
};

export function Badge({
  className,
  tone = "default",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
