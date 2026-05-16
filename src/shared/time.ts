const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

export function nowIso(): string {
  return formatUtc8(new Date());
}

export function addMillisecondsIso(baseIso: string, milliseconds: number): string {
  const d = new Date(new Date(baseIso).getTime() + milliseconds);
  // Preserve the timezone format of the input
  if (baseIso.endsWith("+08:00")) return formatUtc8(d);
  return d.toISOString();
}

function formatUtc8(d: Date): string {
  const shifted = new Date(d.getTime() + UTC8_OFFSET_MS);
  return shifted.toISOString().replace("Z", "+08:00");
}
