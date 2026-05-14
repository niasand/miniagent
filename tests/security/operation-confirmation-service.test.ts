import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OperationConfirmationService } from "../../src/server/security/operation-confirmation-service.js";
import { createTestDatabase, type TestDatabase } from "../support/db.js";

describe("OperationConfirmationService", () => {
  let testDb: TestDatabase;
  let service: OperationConfirmationService;

  beforeEach(() => {
    testDb = createTestDatabase();
    service = new OperationConfirmationService(testDb.db);
  });

  afterEach(() => {
    testDb.close();
  });

  it("stores only a token hash and confirms a dangerous operation", () => {
    const requested = service.request({
      action: "delete_archive",
      resourceType: "memory_archive",
      resourceId: "mem-1",
      riskLevel: "high",
      prompt: "Confirm archive deletion",
      payload: { archiveDate: "2026-05-13" },
      actorType: "web_user",
      actorRef: "user-1",
      requestedAt: "2026-05-14T00:00:00.000Z",
      token: "confirm-token",
    });

    const stored = testDb.db
      .prepare("SELECT token_hash FROM operation_confirmations WHERE id = ?")
      .get(requested.confirmation.id) as { token_hash: string };
    expect(stored.token_hash).not.toBe("confirm-token");
    expect(stored.token_hash).toHaveLength(64);
    expect(() =>
      service.confirm({
        id: requested.confirmation.id,
        token: "wrong",
        confirmedAt: "2026-05-14T00:01:00.000Z",
      }),
    ).toThrow("invalid");

    const confirmed = service.confirm({
      id: requested.confirmation.id,
      token: requested.token,
      confirmedAt: "2026-05-14T00:01:00.000Z",
    });
    expect(confirmed).toMatchObject({
      id: requested.confirmation.id,
      status: "confirmed",
      confirmedAt: "2026-05-14T00:01:00.000Z",
    });

    const consumed = service.consume({
      id: requested.confirmation.id,
      consumedAt: "2026-05-14T00:02:00.000Z",
    });
    expect(consumed.status).toBe("consumed");
    expect(readAuditActions()).toEqual([
      "dangerous_confirmation_requested",
      "dangerous_confirmation_confirmed",
      "dangerous_confirmation_consumed",
    ]);
  });

  it("expires pending confirmations", () => {
    const requested = service.request({
      action: "run_shell",
      resourceType: "session",
      resourceId: "session-1",
      riskLevel: "critical",
      actorType: "feishu_user",
      requestedAt: "2026-05-14T00:00:00.000Z",
      expiresAt: "2026-05-14T00:00:10.000Z",
      token: "confirm-token",
    });

    expect(() =>
      service.confirm({
        id: requested.confirmation.id,
        token: requested.token,
        confirmedAt: "2026-05-14T00:00:11.000Z",
      }),
    ).toThrow("expired");
    expect(
      testDb.db
        .prepare("SELECT status FROM operation_confirmations WHERE id = ?")
        .get(requested.confirmation.id),
    ).toEqual({ status: "expired" });
  });

  function readAuditActions(): string[] {
    return testDb.db
      .prepare("SELECT action FROM audit_logs ORDER BY created_at ASC, id ASC")
      .all()
      .map((row) => (row as { action: string }).action);
  }
});
