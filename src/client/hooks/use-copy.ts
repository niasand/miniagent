import { useCallback, useState } from "react";

/** Clipboard copy with visual feedback. Eliminates duplicated [copied, setCopied] + setTimeout patterns. */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), resetMs);
      });
    },
    [resetMs],
  );
  return { copied, copy } as const;
}
