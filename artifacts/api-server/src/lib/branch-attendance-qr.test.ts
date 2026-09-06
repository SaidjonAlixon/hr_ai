/**
 * QR payload parse / hash — unit tests (no DB).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

const QR_PAYLOAD_PREFIX = "VMHR1";

function hashQrToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function encodeQrPayload(qrId: string, rawToken: string): string {
  return `${QR_PAYLOAD_PREFIX}.${qrId}.${rawToken}`;
}

function parseQrPayload(raw: string): { qrId: string; rawToken: string } | null {
  const s = String(raw || "").trim();
  const parts = s.split(".");
  if (parts.length !== 3) return null;
  const [prefix, qrId, rawToken] = parts;
  if (prefix !== QR_PAYLOAD_PREFIX || !qrId || !rawToken) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(qrId) || !/^[A-Za-z0-9_-]{16,128}$/.test(rawToken)) return null;
  return { qrId, rawToken };
}

describe("branch attendance QR payload", () => {
  it("encodes and parses round-trip", () => {
    const qrId = randomBytes(12).toString("base64url");
    const rawToken = randomBytes(24).toString("base64url");
    const payload = encodeQrPayload(qrId, rawToken);
    const parsed = parseQrPayload(payload);
    assert.ok(parsed);
    assert.equal(parsed!.qrId, qrId);
    assert.equal(parsed!.rawToken, rawToken);
  });

  it("rejects plain branch_id", () => {
    assert.equal(parseQrPayload("12"), null);
    assert.equal(parseQrPayload("branch:12"), null);
  });

  it("hash is stable", () => {
    const t = "abc_token_value_123456";
    assert.equal(hashQrToken(t), hashQrToken(t));
    assert.notEqual(hashQrToken(t), hashQrToken(t + "x"));
  });
});
