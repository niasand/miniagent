import { randomBytes } from "node:crypto";

export type EntityPrefix =
  | "agd"
  | "aud"
  | "cnf"
  | "ctx"
  | "evt"
  | "mem"
  | "msg"
  | "out"
  | "prm"
  | "run"
  | "sch"
  | "ses"
  | "tsk";

export function createId(prefix?: EntityPrefix): string {
  const id = createUuidV7();
  return prefix ? `${prefix}_${id}` : id;
}

let lastTimestamp = 0n;
let seqWithinMs = 0;

function createUuidV7(): string {
  const now = BigInt(Date.now());
  if (now === lastTimestamp) {
    seqWithinMs++;
  } else {
    lastTimestamp = now;
    seqWithinMs = 0;
  }

  const bytes = randomBytes(16);
  const timestamp = now;

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  // Embed monotonic sequence in rand_a field (bits 48-63)
  const seq = seqWithinMs & 0x0fff; // 12 bits max
  bytes[6] = (seq >> 8) | 0x70;
  bytes[7] = seq & 0xff;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
