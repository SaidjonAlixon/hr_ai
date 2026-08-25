import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideFaceAiGate,
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

  it("accepts samePerson without a numeric confidence floor", () => {
    const gate = decideFaceAiGate({ samePerson: true, confidence: 0.5, similarity: 0.5 });
    assert.equal(gate.ok, true);
  });

  it("inspect requires one clear face", () => {
    const two = parseFaceAiInspect({ ok: true, faceCount: 2, quality: 0.9 });
    assert.equal(two?.faceCount, 2);
    const one = parseFaceAiInspect({ ok: true, faceCount: 1, quality: 0.88 });
    assert.equal(one?.ok, true);
  });

  it("gallery matchId must be in the allowed set", () => {
    assert.equal(parseFaceAiIdentify({ matchId: 7 }, [1, 7, 9]), 7);
    assert.equal(parseFaceAiIdentify({ matchId: 3 }, [1, 7, 9]), null);
    assert.equal(parseFaceAiIdentify({ matchId: null }, [1, 7]), null);
  });

  it("picks unique same-person identity and rejects a tie", () => {
    const unique = pickAiIdentityWinner([
      { faceProfileId: 1, userId: 10, samePerson: true, confidence: 0.4, similarity: 0.4 },
      { faceProfileId: 2, userId: 11, samePerson: false, confidence: 0.9, similarity: 0.9 },
    ]);
    assert.equal(unique.ok, true);
    if (unique.ok) assert.equal(unique.userId, 10);

    const tie = pickAiIdentityWinner([
      { faceProfileId: 1, userId: 10, samePerson: true, confidence: 0.94, similarity: 0.94 },
      { faceProfileId: 2, userId: 11, samePerson: true, confidence: 0.93, similarity: 0.93 },
    ]);
    assert.equal(tie.ok, false);
  });
});
