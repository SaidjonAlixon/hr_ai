import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSlotsForDay,
  activePunchSlotsAt,
  punchSlotsForGate,
  slotCoversDate,
  type WorkSlotRow,
} from "./work-slots.ts";
import { atTashkent, DEFAULT_SHIFT_DEFS } from "./attendance-engine.ts";

function slot(partial: Partial<WorkSlotRow> & Pick<WorkSlotRow, "branchId" | "shiftKey" | "mode" | "validFrom">): WorkSlotRow {
  return {
    employeeId: 1,
    active: true,
    ...partial,
  };
}

describe("work-slots resolve + punch window", () => {
  it("bir kunda 2 filial: 1-smena A, 2-smena B", () => {
    const day = "2026-09-16";
    const slots = [
      slot({
        branchId: 10,
        branchLabel: "Filial A",
        shiftKey: "one",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
      slot({
        branchId: 20,
        branchLabel: "Filial B",
        shiftKey: "two",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const daySlots = resolveSlotsForDay(day, slots);
    assert.equal(daySlots.length, 2);
    assert.equal(daySlots[0]?.branchId, 10);
    assert.equal(daySlots[0]?.shiftKey, "one");
    assert.equal(daySlots[1]?.branchId, 20);
    assert.equal(daySlots[1]?.shiftKey, "two");

    const midShift1 = atTashkent(day, "10:00").getTime();
    const active1 = activePunchSlotsAt(day, daySlots, midShift1, DEFAULT_SHIFT_DEFS, "in");
    assert.equal(active1.length, 1);
    assert.equal(active1[0]?.branchId, 10);

    const midShift2 = atTashkent(day, "19:00").getTime();
    const active2 = activePunchSlotsAt(day, daySlots, midShift2, DEFAULT_SHIFT_DEFS, "in");
    assert.equal(active2.length, 1);
    assert.equal(active2[0]?.branchId, 20);

    const night = atTashkent(day, "03:00").getTime();
    const activeNight = activePunchSlotsAt(day, daySlots, night, DEFAULT_SHIFT_DEFS, "in");
    assert.equal(activeNight.length, 0);

    const gateNight = punchSlotsForGate(day, daySlots, night, DEFAULT_SHIFT_DEFS, "in");
    assert.equal(gateNight.length, 2, "vaqt tashqarisida ham kun slotlari ochiq");
  });

  it("haftalik: faqat tanlangan kunda", () => {
    // 2026-09-16 = Wednesday = 3
    const wed = "2026-09-16";
    const thu = "2026-09-17";
    const s = slot({
      branchId: 5,
      branchLabel: "Haftalik filial",
      shiftKey: "one",
      mode: "weekly",
      validFrom: "2026-01-01",
      weekdays: [3],
    });
    assert.equal(slotCoversDate(s, wed), true);
    assert.equal(slotCoversDate(s, thu), false);
    assert.equal(resolveSlotsForDay(wed, [s]).length, 1);
    assert.equal(resolveSlotsForDay(thu, [s]).length, 0);
  });

  it("haftalik almashtirish: tanlangan kunda asosiy smena o‘rniga, qolgan kunlar asosiy", () => {
    // 2026-09-19 = Saturday = 6
    const sat = "2026-09-19";
    const mon = "2026-09-21";
    const base = slot({
      branchId: 10,
      shiftKey: "one",
      mode: "permanent",
      validFrom: "2026-01-01",
    });
    const override = slot({
      branchId: 10,
      shiftKey: "two",
      mode: "weekly",
      validFrom: "2026-01-01",
      weekdays: [6],
      overrideBase: true,
    });
    const otherBranch = slot({
      branchId: 20,
      shiftKey: "three",
      mode: "permanent",
      validFrom: "2026-01-01",
    });

    const satSlots = resolveSlotsForDay(sat, [base, override]);
    assert.equal(satSlots.length, 1);
    assert.equal(satSlots[0]?.shiftKey, "two");

    const monSlots = resolveSlotsForDay(mon, [base, override]);
    assert.equal(monSlots.length, 1);
    assert.equal(monSlots[0]?.shiftKey, "one");

    const satMulti = resolveSlotsForDay(sat, [base, override, otherBranch]);
    assert.deepEqual(
      satMulti.map((s) => `${s.branchId}:${s.shiftKey}`),
      ["10:two", "20:three"],
      "boshqa filial sloti tegilmaydi",
    );

    const additive = resolveSlotsForDay(sat, [base, { ...override, overrideBase: false }]);
    assert.equal(additive.length, 2, "oddiy haftalik slot avvalgidek qo‘shiladi");
  });

  it("kunlik: faqat workDates ichida", () => {
    const s = slot({
      branchId: 7,
      shiftKey: "two",
      mode: "days",
      validFrom: "2026-09-16",
      validTo: "2026-09-16",
      workDates: ["2026-09-16"],
    });
    assert.equal(resolveSlotsForDay("2026-09-16", [s]).length, 1);
    assert.equal(resolveSlotsForDay("2026-09-17", [s]).length, 0);
  });
});
