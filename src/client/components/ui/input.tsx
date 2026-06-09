import { cva, type VariantProps } from "class-variance-authority";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

const inputVariants = cva(
  "w-full min-w-0 border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-foreground)] text-[13px] outline-none focus:border-[var(--color-ring)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ring)_16%,transparent)]",
  {
    variants: {
      variant: {
        /** Standard bordered input */
        default: "rounded-lg bg-[var(--color-background)]",
        /** Borderless — for search fields embedded in a container */
        ghost: "border-0 bg-transparent focus:shadow-none",
      },
      inputSize: {
        sm: "h-8 px-2.5",
        md: "h-9 px-2.5",
        lg: "h-auto min-h-[56px] max-h-[160px] resize-none p-3.5 text-sm leading-relaxed",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "md",
    },
  },
);

export type InputProps = InputHTMLAttributes<HTMLInputElement> &
  VariantProps<typeof inputVariants>;

export function Input({ className, variant, inputSize, ...props }: InputProps) {
  return (
    <input
      className={cn(inputVariants({ variant, inputSize }), className)}
      {...props}
    />
  );
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  VariantProps<typeof inputVariants>;

export function Textarea({ className, variant, inputSize, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(inputVariants({ variant, inputSize }), className)}
      {...props}
    />
  );
}

export { inputVariants };
