export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export function stringifyJson(value: JsonValue = {}): string {
  return JSON.stringify(value);
}

export function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}
