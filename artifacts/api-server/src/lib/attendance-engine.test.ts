/**
 * Unit tests for attendance-engine (16 ta asosiy ssenariy).
 * Run: node --experimental-strip-types --test src/lib/attendance-engine.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHIFT_DEFS,
  plannedShiftMinutes,
  validateShiftCombination,
  computeDayAttendance,
  mergeIntervals,
  intervalsDurationMin,
  plannedInterval,
  resolveBranchForDay,
  findBranchScheduleConflicts,
  checkMinRestBetweenShifts,
  aggregateMonthly,
  formatDurationUz,
  atTashkent,
  addDaysYmd,
  type BranchAssignment,
} from "./attendance-engine.ts";

describe("shift definitions", () => {
  it("1) 1-smena 08:00–17:00 = 9 soat planned", () => {
    assert.equal(plannedShiftMinutes(SHIFT_DEFS.one), 9 * 60);
  });

  it("2) 2-smena 17:00–23:45 = 6s 45d", () => {
    assert.equal(plannedShiftMinutes(SHIFT_DEFS.two), 6 * 60 + 45);
  });

  it("3) 3-smena overnight 23:00–07:00 = 8 soat", () => {
    assert.equal(plannedShiftMinutes(SHIFT_DEFS.three), 8 * 60);
  });
});

describe("shift combination rules", () => {
  it("10) 1+2+3 rejected", () => {
    const r = validateShiftCombination(["one", "two", "three"]);
    assert.equal(r.ok, false);
  });

  it("1+2 allowed", () => {
    assert.equal(validateShiftCombination(["one", "two"]).ok, true);
  });

  it("2+3 allowed", () => {
    assert.equal(validateShiftCombination(["two", "three"]).ok, true);
  });

  it("1+3 warning", () => {
    const r = validateShiftCombination(["one", "three"]);
    assert.equal(r.ok, true);
    assert.ok(r.warning);
  });
});

describe("planned overlap 2+3", () => {
  it("9) 2+3 planned merge = 14 soat (overlap 45m once)", () => {
    const d = "2026-09-06";
    const a = plannedInterval(d, "two");
    const b = plannedInterval(d, "three");
    const merged = mergeIntervals([a, b]);
    const mins = intervalsDurationMin(merged);
    assert.equal(mins, 14 * 60);
    const sum = Math.round((a.endMs - a.startMs) / 60_000) + Math.round((b.endMs - b.startMs) / 60_000);
    assert.equal(sum - mins, 45);
  });
});

describe("real punches", () => {
  it("1) 1-smena late 10m + early leave 10m", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["one"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent(d, "08:10"),
          checkOutAt: atTashkent(d, "16:50"),
        },
      ],
    });
    assert.equal(r.lateArrivalMin, 10);
    assert.equal(r.earlyLeaveMin, 10);
    assert.equal(r.rawWorkedMinutes, 8 * 60 + 40); // 08:10–16:50
    assert.equal(r.paidWorkedMinutes, 8 * 60 + 40 - 60); // unpaid lunch 60
    assert.equal(r.missingCheckout, false);
  });

  it("2) 1+2 smena real punches unpaid lunch", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["one", "two"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent(d, "08:00"),
          checkOutAt: atTashkent(d, "17:00"),
        },
        {
          shiftKey: "two",
          checkInAt: atTashkent(d, "17:00"),
          checkOutAt: atTashkent(d, "23:45"),
        },
      ],
    });
    // 9h + 6h45 = 15h45 raw; unpaid 60 → 14h45 paid
    assert.equal(r.rawWorkedMinutes, 15 * 60 + 45);
    assert.equal(r.paidWorkedMinutes, 14 * 60 + 45);
  });

  it("3+4+5) 2+3 overnight with overlap dedupe", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["two", "three"],
      segments: [
        {
          shiftKey: "two",
          checkInAt: atTashkent(d, "17:00"),
          checkOutAt: atTashkent(d, "23:45"),
        },
        {
          shiftKey: "three",
          checkInAt: atTashkent(d, "23:00"),
          checkOutAt: atTashkent(addDaysYmd(d, 1), "07:00"),
        },
      ],
    });
    assert.equal(r.rawWorkedMinutes, 14 * 60);
    assert.equal(r.overlapMinutes, 45);
    assert.equal(r.paidWorkedMinutes, 14 * 60); // no unpaid on 2/3
  });

  it("5) 3-smena alone overnight belongs to start date", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["three"],
      segments: [
        {
          shiftKey: "three",
          checkInAt: atTashkent(d, "23:00"),
          checkOutAt: atTashkent(addDaysYmd(d, 1), "07:00"),
        },
      ],
    });
    assert.equal(r.rawWorkedMinutes, 8 * 60);
    assert.equal(r.workDate, d);
  });

  it("6) late arrival 12 min (minutes from start; status late after grace)", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["one"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent(d, "08:12"),
          checkOutAt: atTashkent(d, "17:00"),
        },
      ],
    });
    assert.equal(r.lateArrivalMin, 12);
    // 12 < grace 15 → present, lekin kechikish daqiqasi yoziladi
    assert.equal(r.status, "present");
  });

  it("7) early leave 20 min", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["one"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent(d, "08:00"),
          checkOutAt: atTashkent(d, "16:40"),
        },
      ],
    });
    assert.equal(r.earlyLeaveMin, 20);
  });

  it("8) missing checkout → incomplete, 0 worked (not 24h)", () => {
    const d = "2026-09-06";
    const r = computeDayAttendance({
      workDate: d,
      shiftKeys: ["one"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent(d, "08:00"),
          checkOutAt: null,
        },
      ],
    });
    assert.equal(r.missingCheckout, true);
    assert.equal(r.rawWorkedMinutes, 0);
    assert.equal(r.paidWorkedMinutes, 0);
    assert.equal(r.status, "incomplete");
  });
});

describe("branch resolution", () => {
  it("11+12+13) priority substitute > temp > rotation > permanent", () => {
    const d = "2026-09-06";
    const assignments: BranchAssignment[] = [
      { kind: "permanent", branchId: 1, branchLabel: "Chilonzor", validFrom: "2026-01-01" },
      {
        kind: "rotation",
        branchId: 2,
        branchLabel: "Sergeli",
        validFrom: "2026-09-01",
        validTo: "2026-09-15",
      },
      {
        kind: "temp_one_day",
        branchId: 3,
        branchLabel: "Yunusobod-temp",
        validFrom: "2026-09-06",
        validTo: "2026-09-06",
      },
      {
        kind: "substitute",
        branchId: 4,
        branchLabel: "Yunusobod-sub",
        validFrom: "2026-09-06",
        validTo: "2026-09-06",
        replacesEmployeeId: 99,
      },
    ];
    const r = resolveBranchForDay(d, assignments);
    assert.equal(r?.branchId, 4);
    assert.equal(r?.kind, "substitute");

    const after = resolveBranchForDay("2026-09-16", assignments);
    assert.equal(after?.branchId, 1);
    assert.equal(after?.kind, "permanent");

    const midRot = resolveBranchForDay("2026-09-10", [
      assignments[0],
      assignments[1],
    ]);
    assert.equal(midRot?.branchId, 2);
  });

  it("14) concurrent two branches conflict", () => {
    const d = "2026-09-06";
    const a = atTashkent(d, "10:00").getTime();
    const b = atTashkent(d, "18:00").getTime();
    const c = atTashkent(d, "15:00").getTime();
    const e = atTashkent(d, "20:00").getTime();
    const err = findBranchScheduleConflicts([
      { branchId: 1, startMs: a, endMs: b, label: "Chilonzor" },
      { branchId: 2, startMs: c, endMs: e, label: "Sergeli" },
    ]);
    assert.ok(err);
  });
});

describe("rest between shifts", () => {
  it("3-smena then next day 08:00 warns if min rest 12h", () => {
    const d = "2026-09-06";
    const end = plannedInterval(d, "three").endMs;
    const next = plannedInterval(addDaysYmd(d, 1), "one").startMs;
    const warn = checkMinRestBetweenShifts(end, next);
    assert.ok(warn); // 1 hour gap
  });
});

describe("monthly + format", () => {
  it("15) monthly aggregate", () => {
    const d1 = computeDayAttendance({
      workDate: "2026-09-01",
      shiftKeys: ["one"],
      segments: [
        {
          shiftKey: "one",
          checkInAt: atTashkent("2026-09-01", "08:00"),
          checkOutAt: atTashkent("2026-09-01", "17:00"),
        },
      ],
    });
    const d2 = computeDayAttendance({
      workDate: "2026-09-02",
      shiftKeys: ["three"],
      segments: [
        {
          shiftKey: "three",
          checkInAt: atTashkent("2026-09-02", "23:00"),
          checkOutAt: atTashkent("2026-09-03", "07:00"),
        },
      ],
    });
    const m = aggregateMonthly([d1, d2]);
    assert.equal(m.workDays, 2);
    assert.equal(m.rawWorkedMinutes, 9 * 60 + 8 * 60);
    assert.equal(m.paidWorkedMinutes, 8 * 60 + 8 * 60);
  });

  it("formatDurationUz", () => {
    assert.equal(formatDurationUz(14 * 60 + 45), "14 soat 45 daqiqa");
  });
});
