import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const buttonVariants = cva(
  "inline-flex h-[34px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[7px] border px-[11px] text-sm font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-border bg-white/75 text-foreground hover:bg-white",
        primary: "border-ink bg-ink text-white hover:bg-ink/90",
        ghost: "border-transparent bg-transparent hover:bg-muted",
      },
      size: {
        default: "h-[34px] px-[11px]",
        icon: "h-[34px] w-[34px] px-0",
        sm: "h-[34px] px-[11px] text-sm",
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
