import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-semibold transition-[background,border-color,color,opacity] duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        /** Primary CTA — solid brand-colored background */
        primary:
          "border-0 rounded-lg bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-[0.88]",

        /** Default / secondary — bordered with surface bg */
        default:
          "border rounded-lg border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-muted)]",

        /** Destructive — secondary shell with red text */
        destructive:
          "border rounded-lg border-[var(--color-border)] bg-[var(--color-surface)] text-[#dc2626] hover:bg-[var(--color-muted)]",

        /** Outline — subtle border, transparent bg */
        outline:
          "border rounded-lg border-[var(--color-border)] bg-transparent text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",

        /** Ghost — no border, transparent bg for icon-only actions */
        ghost:
          "border-0 bg-transparent text-[var(--color-muted-foreground)] rounded-md hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",

        /** Accent — primary-tinted border and background */
        accent:
          "border rounded-md border-[color-mix(in_srgb,var(--color-primary)_24%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-surface))] text-[var(--color-primary)] hover:border-[color-mix(in_srgb,var(--color-primary)_40%,var(--color-border))] hover:bg-[color-mix(in_srgb,var(--color-primary)_14%,var(--color-surface))]",
      },
      size: {
        default: "h-9 px-3 text-[13px]",
        sm: "h-[30px] px-3.5 text-xs",
        xs: "h-7 w-7 p-0",
        icon: "h-9 w-9 p-0",
        lg: "h-14 w-14 p-0 rounded-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
