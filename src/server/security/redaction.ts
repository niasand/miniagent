import type { JsonValue } from "../../shared/json.js";

const REDACTED = "[REDACTED]";
const SECRET_KEY_PATTERN = /(api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
  /\b(xox[baprs]-[A-Za-z0-9-]{12,})\b/g,
  /\b((?:api[_-]?key|password|secret|token)=)[^\s&]+/gi,
];

export function redactJson(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }

  const redacted: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactJson(item);
  }
  return redacted;
}

export function redactString(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix: string | undefined) => {
      if (typeof prefix === "string" && match.toLowerCase().startsWith(prefix.toLowerCase())) {
        return `${prefix}${REDACTED}`;
      }
      if (/^Bearer\s/i.test(match)) {
        return `Bearer ${REDACTED}`;
      }
      if (match.startsWith("sk-")) {
        return "sk-[REDACTED]";
      }
      return REDACTED;
    });
  }
  return redacted;
}
