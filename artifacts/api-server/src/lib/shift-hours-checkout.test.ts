/**
 * Ketdim muddatlari — jadval bilan solishtirish (smena-hours logikasining nusxasi).
 * shift-hours.ts Node testda extension zanjiri tufayli to‘g‘ridan import qilinmaydi.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDaysYmd } from "./attendance-engine.ts";

const CHECKOUT_DEADLINE_HM = "23:55";
const CHECKOUT_DEADLINE_SHIFT_TWO_HM = "02:00";
const CHECKOUT_DEADLINE_SHIFT_THREE_HM = "10:00";

function deadline(
  workDate: string,
  endHm: string,
  overnight: boolean,
  kind: "one" | "two" | "three",
): Date {
  const endDay = overnight ? addDaysYmd(workDate, 1) : workDate;
  if (kind === "three") return new Date(`${endDay}T${CHECKOUT_DEADLINE_SHIFT_THREE_HM}:00+05:00`);
  if (kind === "two") return new Date(`${addDaysYmd(endDay, 1)}T${CHECKOUT_DEADLINE_SHIFT_TWO_HM}:00+05:00`);
  return new Date(`${endDay}T${CHECKOUT_DEADLINE_HM}:00+05:00`);
}

function stamp(d: Date): string {
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Tashkent" });
}

describe("Ketdim muddatlari (smena jadvali)", () => {
  const work = "2026-09-25";

  it("1-smena 08:00–17:00 → shu kun 23:55", () => {
    assert.equal(stamp(deadline(work, "17:00", false, "one")), "2026-09-25 23:55:00");
  });
  it("2-smena 17:00–23:45 → ertasi 02:00", () => {
    assert.equal(stamp(deadline(work, "23:45", false, "two")), "2026-09-26 02:00:00");
  });
  it("3-smena 23:00–07:00 → ertalab 10:00", () => {
    assert.equal(stamp(deadline(work, "07:00", true, "three")), "2026-09-26 10:00:00");
  });
  it("ofis 09:00–18:00 → shu kun 23:55", () => {
    assert.equal(stamp(deadline(work, "18:00", false, "one")), "2026-09-25 23:55:00");
  });
  it("1+2 08:00–23:45 → ertasi 02:00", () => {
    assert.equal(stamp(deadline(work, "23:45", false, "two")), "2026-09-26 02:00:00");
  });
  it("2+3 17:00–07:00 → ertalab 10:00", () => {
    assert.equal(stamp(deadline(work, "07:00", true, "three")), "2026-09-26 10:00:00");
  });
});
