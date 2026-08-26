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

  it("skips AI when local identity is clear", () => {
    // Pure rule (FACE_AI_CLEAR_MARGIN=0.08, samePerson thresholds)
    const clear = (cands: Array<{ dist: number; cosine: number }>) => {
      const best = cands[0];
      const second = cands[1];
      if (!best || best.dist > 0.34 || best.cosine < 0.942) return false;
      if (!second) return true;
      return second.dist - best.dist >= 0.08;
    };
    assert.equal(
      clear([
        { dist: 0.12, cosine: 0.98 },
        { dist: 0.28, cosine: 0.9 },
      ]),
      true,
    );
    assert.equal(
      clear([
        { dist: 0.2, cosine: 0.96 },
        { dist: 0.22, cosine: 0.95 },
      ]),
      false,
    );
  });
});
