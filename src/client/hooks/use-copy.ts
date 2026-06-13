import { useCallback, useState } from "react";

/** Clipboard copy with visual feedback. Eliminates duplicated [copied, setCopied] + setTimeout patterns. */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text: string) => {
      await copyText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );
  return { copied, copy } as const;
}

async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    fallbackCopyText(text);
    return;
  }

  const wrote = await Promise.race([
    navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
  ]);

  if (!wrote) {
    fallbackCopyText(text);
  }
}

function fallbackCopyText(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}
