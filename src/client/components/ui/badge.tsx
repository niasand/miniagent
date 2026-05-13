import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

type BadgeTone = "default" | "green" | "amber" | "blue" | "red";

const toneClass: Record<BadgeTone, string> = {
  default: "border-border bg-white text-foreground",
  green: "border-emerald-600/25 bg-emerald-600/10 text-emerald-700",
  amber: "border-amber-700/30 bg-amber-700/10 text-amber-700",
  blue: "border-blue-700/25 bg-blue-700/10 text-blue-700",
  red: "border-red-700/25 bg-red-700/10 text-red-700",
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
        "inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-[7px] py-0.5 text-[11px] font-medium",
        toneClass[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
