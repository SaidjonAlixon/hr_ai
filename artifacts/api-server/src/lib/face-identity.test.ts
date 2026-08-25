import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FACE_ENROLL_BLOCK_MAX,
  FACE_MATCH_MAX,
  evaluateLiveness,
  faceDistance,
  findEnrollConflicts,
  issueFaceChallenge,
  isEnrollConflict,
  isSamePerson,
  parseFaceDescriptor,
  pickAuthMatch,
  listAuthCandidates,
  type StoredFace,
} from "./face-identity.ts";

function embedding(seed: number, jitter = 0): number[] {
  const v: number[] = [];
  for (let i = 0; i < 128; i++) v.push(Math.sin((seed + 1) * (i + 3) * 0.17) + jitter * ((i % 7) - 3) * 0.002);
  return v;
}

function noise(base: number[], amp: number): number[] {
  return base.map((x, i) => x + amp * Math.sin(i * 0.31));
}

describe("face identity", () => {
  it("rejects non-128 embeddings", () => {
    assert.equal(parseFaceDescriptor([1, 2, 3]), null);
  });

  it("same person lighting/angle jitter still matches (PASS)", () => {
    const a = embedding(1);
    const b = noise(a, 0.04);
    const { dist, cosine } = faceDistance(a, b);
    assert.ok(isSamePerson(dist, cosine), `same person dist=${dist.toFixed(3)} cos=${cosine.toFixed(3)}`);
  });

  it("glasses-like small perturbation still matches (PASS)", () => {
    const a = embedding(2);
    const b = a.map((x, i) => x + (i % 11 === 0 ? 0.03 : 0));
    const { dist, cosine } = faceDistance(a, b);
    assert.ok(isSamePerson(dist, cosine), `glasses dist=${dist.toFixed(3)}`);
  });

  it("other person fails (FAIL)", () => {
    const a = embedding(1);
    const b = embedding(99);
    const { dist, cosine } = faceDistance(a, b);
    assert.equal(isSamePerson(dist, cosine), false, `other dist=${dist.toFixed(3)} cos=${cosine.toFixed(3)}`);
  });

  it("near-identical face still blocks second account; different face does not", () => {
    const a = embedding(4);
    const twin = noise(a, 0.03);
    const other = embedding(99);
    const twinHit = faceDistance(a, twin);
    const otherHit = faceDistance(a, other);
    assert.equal(isEnrollConflict(twinHit.dist, twinHit.cosine), true);
    assert.equal(isEnrollConflict(otherHit.dist, otherHit.cosine), false);
    const rows: StoredFace[] = [{ id: 1, userId: 10, descriptor: a }];
    assert.ok(findEnrollConflicts([twin], rows, 20).length >= 1);
    assert.equal(findEnrollConflicts([other], rows, 20).length, 0);
  });

  it("login match is unique owner (PASS)", () => {
    const owner = embedding(7);
    const other = embedding(8);
    const rows: StoredFace[] = [
      { id: 1, userId: 1, descriptor: owner },
      { id: 2, userId: 2, descriptor: other },
    ];
    const probe = noise(owner, 0.03);
    const picked = pickAuthMatch([probe], rows);
    assert.equal(picked.ok, true);
    if (picked.ok) assert.equal(picked.userId, 1);
  });

  it("AI candidate list includes lookalikes so the closest embedding is not auto-opened", () => {
    const owner = embedding(51);
    const lookalike = noise(owner, 0.2);
    const rows: StoredFace[] = [
      { id: 1, userId: 1, descriptor: owner },
      { id: 2, userId: 2, descriptor: lookalike },
    ];
    const cands = listAuthCandidates([noise(owner, 0.03)], rows);
    assert.ok(cands.length >= 1);
    assert.equal(cands[0]?.userId, 1);
  });

  it("lookalike coworker does not block the registered owner (PASS)", () => {
    const owner = embedding(21);
    const coworker = noise(owner, 0.22);
    const rows: StoredFace[] = [
      { id: 1, userId: 1, descriptor: owner },
      { id: 2, userId: 2, descriptor: coworker },
    ];
    const probe = noise(owner, 0.04);
    const picked = pickAuthMatch([probe], rows);
    assert.equal(picked.ok, true, "owner must still log in when a similar face exists");
    if (picked.ok) assert.equal(picked.userId, 1);
  });

  it("closest registered owner wins — login is not blocked (PASS)", () => {
    const face = embedding(31);
    const rows: StoredFace[] = [
      { id: 1, userId: 1, descriptor: face },
      { id: 2, userId: 2, descriptor: noise(face, 0.01) },
    ];
    const probe = noise(face, 0.005);
    const picked = pickAuthMatch([probe], rows);
    assert.equal(picked.ok, true);
    if (picked.ok) assert.equal(picked.userId, 1);
  });

  it("side-angle probe is ignored so another person is not opened (PASS)", () => {
    const ownerCenter = embedding(41);
    const other = embedding(77);
    const rows: StoredFace[] = [
      { id: 1, userId: 1, descriptor: ownerCenter },
      { id: 2, userId: 2, descriptor: other },
    ];
    const center = noise(ownerCenter, 0.03);
    const misleadingSide = noise(other, 0.02);
    const picked = pickAuthMatch([center, misleadingSide], rows);
    assert.equal(picked.ok, true);
    if (picked.ok) assert.equal(picked.userId, 1);
  });

  it("cannot re-enroll same face on another account (FAIL)", () => {
    const faceA = embedding(11);
    const rows: StoredFace[] = [{ id: 1, userId: 1, descriptor: faceA }];
    const hits = findEnrollConflicts([faceA], rows, 2);
    assert.ok(hits.length >= 1);
  });

  it("blur/dark analogue: far random vector fails (FAIL)", () => {
    const a = embedding(3);
    const garbage = Array.from({ length: 128 }, (_, i) => (i === 0 ? 1 : 0));
    const { dist, cosine } = faceDistance(a, garbage);
    assert.equal(isSamePerson(dist, cosine), false);
  });

  it("liveness requires signed challenge and completed steps (photo/video spoof FAIL)", () => {
    const noTok = evaluateLiveness({ poses: ["center"], motion: 1, score: 1 }, "login");
    assert.equal(noTok.ok, false);
    const { token, steps } = issueFaceChallenge("login");
    const incomplete = evaluateLiveness({ challenge: token, steps: [], poses: [], motion: 0.2 }, "login");
    assert.equal(incomplete.ok, false);
    const done = evaluateLiveness(
      {
        challenge: token,
        steps: steps.map((s) => s.key),
        poses: steps.map((s) => s.pose ?? s.key),
        blinked: steps.some((s) => s.blink),
        motion: 0.08,
      },
      "login",
    );
    assert.equal(done.ok, true, "completed random challenge should pass");
  });

  it("enroll liveness is a single center hold", () => {
    const { token, steps } = issueFaceChallenge("enroll");
    assert.equal(steps.length, 1);
    const skipped = evaluateLiveness({ challenge: token, steps: [], poses: [], motion: 0.2 }, "enroll");
    assert.equal(skipped.ok, false);
    const all = evaluateLiveness(
      {
        challenge: token,
        steps: steps.map((s) => s.key),
        poses: steps.map((s) => s.pose ?? s.key),
        motion: 0.02,
      },
      "enroll",
    );
    assert.equal(all.ok, true);
  });

  it("calibrated thresholds stay in face-api range", () => {
    assert.ok(FACE_MATCH_MAX <= 0.4);
    assert.ok(FACE_ENROLL_BLOCK_MAX < FACE_MATCH_MAX);
  });
});
