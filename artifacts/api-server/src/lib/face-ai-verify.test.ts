import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideFaceAiGate,
  loginFailFromScores,
  parseFaceAiIdentify,
  parseFaceAiInspect,
  parseFaceAiPayload,
  pickAiIdentityWinner,
} from "./face-ai-decision.ts";

describe("face AI verify", () => {
  it("parses OpenAI JSON verdict", () => {
    const v = parseFaceAiPayload({ samePerson: true, confidence: 0.93, similarity: 0.91 });
    assert.equal(v?.samePerson, true);
    assert.equal(v?.confidence, 0.93);
  });

  it("rejects a different person", () => {
    const gate = decideFaceAiGate({ samePerson: false, confidence: 0.92, similarity: 0.4 });
    assert.equal(gate.ok, false);
    if (!gate.ok) assert.equal(gate.code, "face_ai_mismatch");
  });

  it("rejects samePerson with low confidence", () => {
    const gate = decideFaceAiGate({ samePerson: true, confidence: 0.5, similarity: 0.5 });
    assert.equal(gate.ok, false);
  });

  it("accepts high-confidence same person", () => {
    const gate = decideFaceAiGate({ samePerson: true, confidence: 0.95, similarity: 0.92 });
    assert.equal(gate.ok, true);
  });

  it("inspect requires one live face and rejects spoof", () => {
    const two = parseFaceAiInspect({ ok: true, faceCount: 2, quality: 0.9, liveHuman: true });
    assert.equal(two?.ok, false);
    const one = parseFaceAiInspect({ ok: true, faceCount: 1, quality: 0.88, liveHuman: true });
    assert.equal(one?.ok, true);
    const spoof = parseFaceAiInspect({
      ok: true,
      faceCount: 1,
      quality: 0.95,
      spoof: true,
      liveHuman: false,
    });
    assert.equal(spoof?.spoof, true);
    assert.equal(spoof?.ok, false);
  });

  it("gallery matchId must be in the allowed set", () => {
    assert.equal(parseFaceAiIdentify({ matchId: 7 }, [1, 7, 9]), 7);
    assert.equal(parseFaceAiIdentify({ matchId: 3 }, [1, 7, 9]), null);
    assert.equal(parseFaceAiIdentify({ matchId: null }, [1, 7]), null);
  });

  it("explains unregistered vs retry vs ambiguous", () => {
    const far = loginFailFromScores({ ambiguous: false, closestDist: 0.7, ownerMaxDist: 0.34 });
    assert.equal(far.code, "face_not_registered");
    assert.match(far.error, /ro‘yxatdan o‘tmagan/);
    const near = loginFailFromScores({ ambiguous: false, closestDist: 0.3, ownerMaxDist: 0.34 });
    assert.equal(near.code, "face_ai_mismatch");
    assert.match(near.error, /Kameraga tik/);
    const two = loginFailFromScores({ ambiguous: true, closestDist: 0.2, ownerMaxDist: 0.34 });
    assert.equal(two.code, "face_ai_low_confidence");
    assert.match(two.error, /bir nechta/);
  });

  it("picks unique same-person identity and rejects a tie", () => {
    const unique = pickAiIdentityWinner([
      { faceProfileId: 1, userId: 10, samePerson: true, confidence: 0.95, similarity: 0.93 },
      { faceProfileId: 2, userId: 11, samePerson: false, confidence: 0.9, similarity: 0.9 },
    ]);
    assert.equal(unique.ok, true);
    if (unique.ok) assert.equal(unique.userId, 10);

    const weak = pickAiIdentityWinner([
      { faceProfileId: 1, userId: 10, samePerson: true, confidence: 0.4, similarity: 0.4 },
    ]);
    assert.equal(weak.ok, false);

    const tie = pickAiIdentityWinner([
      { faceProfileId: 1, userId: 10, samePerson: true, confidence: 0.94, similarity: 0.94 },
      { faceProfileId: 2, userId: 11, samePerson: true, confidence: 0.93, similarity: 0.93 },
    ]);
    assert.equal(tie.ok, false, "close AI tie must not open either account");
  });
});
