import { CheckCircle2, Copy } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { useCopy } from "../../hooks/use-copy.js";
import { cn } from "../../lib/utils.js";

export type CopyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Text to copy to clipboard */
  text: string;
  /** Accessible label, e.g. "会话名称" */
  label?: string;
  /** Visual size variant */
  size?: "sm" | "md";
};

export function CopyButton({ text, label, size = "sm", className, ...props }: CopyButtonProps) {
  const { copied, copy } = useCopy();

  return (
    <button
      className={cn(
        "copy-button inline-flex items-center justify-center border-none bg-transparent p-0.5 flex-shrink-0 cursor-pointer rounded",
        !copied && "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]",
        size === "sm" && "h-5 w-5",
        size === "md" && "h-6 w-6",
        className,
      )}
      data-copied={copied ? "true" : "false"}
      title={copied ? "已复制" : `复制${label ?? ""}`}
      onClick={() => copy(text)}
      {...props}
    >
      {copied ? <CheckCircle2 className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <Copy className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />}
    </button>
  );
}
