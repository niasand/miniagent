export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export function stringifyJson(value: JsonValue = {}): string {
  return JSON.stringify(value);
}

export function parseJson(value: string): JsonValue {
  return JSON.parse(value) as JsonValue;
}
