import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canManageCustomerRatings,
  canSeeCustomerIdentity,
  canViewCustomerRatings,
  canViewCustomerLeaderboard,
  leaderboardTitleForRank,
  normalizePhone,
  pickOnDutyShiftForEmployee,
  sortLeaderboardRows,
  SERVICE_QUALITY,
  DEMEANOR,
} from "./customer-ratings-core.ts";
import { atTashkent, DEFAULT_SHIFT_DEFS, addDaysYmd } from "./attendance-engine.ts";
import type { WorkSlotRow } from "./work-slots.ts";

function slot(
  partial: Partial<WorkSlotRow> & Pick<WorkSlotRow, "branchId" | "shiftKey" | "mode" | "validFrom">,
): WorkSlotRow {
  return {
    employeeId: 1,
    active: true,
    ...partial,
  };
}

describe("customer-ratings roles", () => {
  it("admin/HR boshqaradi, mudir/koordinator faqat ko‘radi", () => {
    assert.equal(canManageCustomerRatings("admin"), true);
    assert.equal(canManageCustomerRatings("hr"), true);
    assert.equal(canManageCustomerRatings("mudir"), false);
    assert.equal(canManageCustomerRatings("koordinator"), false);
    assert.equal(canManageCustomerRatings("farmasevt"), false);

    assert.equal(canViewCustomerRatings("mudir"), true);
    assert.equal(canViewCustomerRatings("koordinator"), true);
    assert.equal(canViewCustomerRatings("regional_menejer"), true);
    assert.equal(canViewCustomerRatings("farmasevt"), false);

    assert.equal(canSeeCustomerIdentity("admin"), true);
    assert.equal(canSeeCustomerIdentity("mudir"), false);
    assert.equal(canSeeCustomerIdentity("koordinator"), false);
  });
});

describe("customer-ratings phone normalize", () => {
  it("998 va lokal formatni bir xillashtiradi", () => {
    assert.equal(normalizePhone("+998 90 123 45 67"), "998901234567");
    assert.equal(normalizePhone("901234567"), "998901234567");
    assert.equal(normalizePhone("90-123-45-67"), "998901234567");
    assert.equal(normalizePhone("123"), "123");
  });
});

describe("customer-ratings on-duty branch + overnight", () => {
  const today = "2026-11-09";
  const yesterday = addDaysYmd(today, -1);
  const branchA = 10;
  const branchB = 20;

  it("noto‘g‘ri filial slotini chiqarmaydi", () => {
    const slots = [
      slot({
        branchId: branchB,
        branchLabel: "B",
        shiftKey: "one",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const mid = atTashkent(today, "10:00").getTime();
    const pick = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: mid,
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.equal(pick, null);
  });

  it("faol bo‘lmagan smenani chiqarmaydi", () => {
    const slots = [
      slot({
        branchId: branchA,
        shiftKey: "one",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const evening = atTashkent(today, "20:00").getTime();
    const pick = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: evening,
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.equal(pick, null);
  });

  it("to‘g‘ri filialda kunduzgi smena chiqadi", () => {
    const slots = [
      slot({
        branchId: branchA,
        shiftKey: "one",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
      slot({
        branchId: branchB,
        shiftKey: "two",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const mid = atTashkent(today, "11:00").getTime();
    const pick = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: mid,
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.ok(pick);
    assert.equal(pick!.shiftKey, "one");
    assert.equal(pick!.workDate, today);
  });

  it("tungi (overnight) smena kecha ish kuni bilan hisoblanadi", () => {
    const slots = [
      slot({
        branchId: branchA,
        shiftKey: "three",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const night = atTashkent(today, "03:00").getTime();
    const pick = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: night,
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.ok(pick, "tungi smena topilishi kerak");
    assert.equal(pick!.shiftKey, "three");
    assert.equal(pick!.workDate, yesterday);
  });

  it("slot yo‘q bo‘lsa null", () => {
    const pick = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots: [],
      today,
      yesterday,
      nowMs: atTashkent(today, "10:00").getTime(),
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.equal(pick, null);
  });

  it("2-smena: slot branch boshqa id bo‘lsa relax bilan topiladi", () => {
    const slots = [
      slot({
        branchId: branchB,
        shiftKey: "two",
        mode: "permanent",
        validFrom: "2026-01-01",
      }),
    ];
    const evening = atTashkent(today, "18:30").getTime();
    const strict = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: evening,
      defs: DEFAULT_SHIFT_DEFS,
    });
    assert.equal(strict, null);
    const relaxed = pickOnDutyShiftForEmployee({
      branchId: branchA,
      slots,
      today,
      yesterday,
      nowMs: evening,
      defs: DEFAULT_SHIFT_DEFS,
      relaxBranchMatch: true,
    });
    assert.ok(relaxed);
    assert.equal(relaxed!.shiftKey, "two");
  });
});

describe("customer-ratings enums", () => {
  it("xizmat va muomala qiymatlari to‘liq", () => {
    assert.deepEqual([...SERVICE_QUALITY], ["alo", "yaxshi", "qoniqarli", "yomon", "juda_yomon"]);
    assert.deepEqual([...DEMEANOR], ["xushmuomala", "yaxshi", "oddiy", "qopol", "juda_qopol"]);
  });
});

describe("customer-ratings leaderboard", () => {
  it("farmasevt/stajyor/mudir reytingni ko‘radi", () => {
    assert.equal(canViewCustomerLeaderboard("farmasevt"), true);
    assert.equal(canViewCustomerLeaderboard("stajyor"), true);
    assert.equal(canViewCustomerLeaderboard("mudir"), true);
    assert.equal(canViewCustomerLeaderboard("admin"), true);
    assert.equal(canViewCustomerLeaderboard("ofis"), false);
  });

  it("top-3 unvonlari", () => {
    assert.equal(leaderboardTitleForRank(1), "best");
    assert.equal(leaderboardTitleForRank(2), "responsible");
    assert.equal(leaderboardTitleForRank(3), "trusted");
    assert.equal(leaderboardTitleForRank(4), null);
  });

  it("o‘rtacha ↓ keyin ovoz ↓ tartiblaydi", () => {
    const sorted = sortLeaderboardRows([
      { name: "B", avg: 4.5, count: 10 },
      { name: "A", avg: 4.9, count: 2 },
      { name: "C", avg: 4.5, count: 20 },
    ]);
    assert.deepEqual(
      sorted.map((x) => x.name),
      ["A", "C", "B"],
    );
  });
});
