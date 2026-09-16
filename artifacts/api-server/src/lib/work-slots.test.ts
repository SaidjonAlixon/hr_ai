import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSlotsForDay,
  activePunchSlotsAt,
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
