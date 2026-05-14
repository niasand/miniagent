import { describe, expect, it } from "vitest";
import { AuditLogStore } from "../../src/server/audit/audit-log-store.js";
import { OutboxStore } from "../../src/server/events/outbox-store.js";
import { parseJson } from "../../src/shared/json.js";
import { createTestDatabase } from "../support/db.js";
import { insertActiveRunFixture } from "../support/fixtures.js";

describe("secret redaction", () => {
  it("redacts secrets from AuditLog payloads and Outbox view models", () => {
    const testDb = createTestDatabase();
    try {
      insertActiveRunFixture(testDb.db);
      const audit = new AuditLogStore(testDb.db);
      const outbox = new OutboxStore(testDb.db);

      const log = audit.insert({
        actorType: "system",
        action: "secret_access_failure",
        resourceType: "session",
        resourceId: "session-1",
        payload: {
          token: "sk-1234567890abcdefghijklmnop",
          message: "password=hunter2",
        },
      });
      const item = outbox.enqueue({
        sessionId: "session-1",
        channelType: "feishu",
        targetRef: "chat-1",
        kind: "feishu_card_update",
        viewModel: {
          authorization: "Bearer abcdefghijklmnop",
          text: "api_key=secret-value",
        },
        idempotencyKey: "feishu:redaction",
      });

      expect(log.payload).toEqual({
        token: "[REDACTED]",
        message: "password=[REDACTED]",
      });
      expect(parseJson(item.viewModelJson)).toEqual({
        authorization: "[REDACTED]",
        text: "api_key=[REDACTED]",
      });
    } finally {
      testDb.close();
    }
  });
});
