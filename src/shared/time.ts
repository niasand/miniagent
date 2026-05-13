export function nowIso(): string {
  return new Date().toISOString();
}

export function addMillisecondsIso(baseIso: string, milliseconds: number): string {
  return new Date(new Date(baseIso).getTime() + milliseconds).toISOString();
}
