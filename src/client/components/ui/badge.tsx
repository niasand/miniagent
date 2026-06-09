import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const badgeVariants = cva("inline-flex items-center font-medium", {
  variants: {
    shape: {
      /** Pill-shaped tag — for schedule/provider status */
      pill: "rounded-full px-1.5 py-px text-[10px] font-semibold uppercase leading-snug",
      /** Small colored dot + label — for channel status */
      dot: "gap-1.5 text-[12px] font-semibold leading-none",
      /** Rectangular block — for preview / test result */
      block: "rounded px-2 py-1 text-[12px]",
    },
    tone: {
      default: "",
      /** Green — success/healthy/active/connected/idle */
      success: "",
      /** Amber — warning/compact/available/missing/paused */
      warning: "",
      /** Red — error/failed/disconnected */
      error: "",
      /** Blue — info/configured/queued/scheduled/running */
      info: "",
      /** Violet — auth_required (unique to providers) */
      violet: "",
      /** Gray/slate — cancelled/unknown */
      muted: "",
    },
  },
  defaultVariants: {
    shape: "pill",
    tone: "default",
  },
});

/** Tone-specific classes per shape */
const toneClasses: Record<string, Record<string, string>> = {
  pill: {
    default: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
    success: "bg-[color-mix(in_srgb,#22c55e_14%,var(--color-surface))] text-[#15803d]",
    warning: "bg-[color-mix(in_srgb,#f59e0b_16%,var(--color-surface))] text-[#b45309]",
    error: "bg-[color-mix(in_srgb,#ef4444_12%,var(--color-surface))] text-[#dc2626]",
    info: "bg-[color-mix(in_srgb,#3b82f6_13%,var(--color-surface))] text-[#1d4ed8]",
    violet: "bg-[color-mix(in_srgb,#8b5cf6_14%,var(--color-surface))] text-[#6d28d9]",
    muted: "bg-[color-mix(in_srgb,#94a3b8_18%,var(--color-surface))] text-[#64748b]",
  },
  dot: {
    default: "text-[var(--color-muted-foreground)]",
    success: "text-[#16a34a]",
    warning: "text-[#d97706]",
    error: "text-[#dc2626]",
    info: "text-[#2563eb]",
    violet: "text-[#7c3aed]",
    muted: "text-[var(--color-muted-foreground)]",
  },
  block: {
    default: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
    success: "bg-[color-mix(in_srgb,#22c55e_10%,transparent)] text-[#22c55e]",
    warning: "bg-[color-mix(in_srgb,#f59e0b_10%,transparent)] text-[#b45309]",
    error: "bg-[color-mix(in_srgb,#ef4444_10%,transparent)] text-[#ef4444]",
    info: "bg-[color-mix(in_srgb,#3b82f6_10%,transparent)] text-[#3b82f6]",
    violet: "bg-[color-mix(in_srgb,#8b5cf6_10%,transparent)] text-[#7c3aed]",
    muted: "bg-[color-mix(in_srgb,#94a3b8_10%,transparent)] text-[#64748b]",
  },
};

/** Dot colors for the "dot" shape variant */
const dotColors: Record<string, string> = {
  default: "bg-[var(--color-muted-foreground)]",
  success: "bg-[#22c55e]",
  warning: "bg-[#f59e0b]",
  error: "bg-[#ef4444]",
  info: "bg-[#3b82f6]",
  violet: "bg-[#8b5cf6]",
  muted: "bg-[var(--color-muted-foreground)]",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, shape, tone, children, ...props }: BadgeProps) {
  const resolvedShape = shape ?? "pill";
  const resolvedTone = tone ?? "default";

  return (
    <span
      className={cn(
        badgeVariants({ shape: resolvedShape, tone: resolvedTone }),
        toneClasses[resolvedShape]?.[resolvedTone],
        className,
      )}
      {...props}
    >
      {resolvedShape === "dot" && (
        <span
          className={cn(
            "inline-block w-[7px] h-[7px] rounded-full flex-shrink-0",
            dotColors[resolvedTone],
          )}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
