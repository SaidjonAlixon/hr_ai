import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMonthsYmd,
  computeCycleStatus,
  computeNextRevisionDate,
  computeRemainingAmount,
  cycleMonthsFromShortage,
} from "./reviziya-cycle.ts";

describe("reviziya-cycle", () => {
  it("cycle months from shortage", () => {
    assert.equal(cycleMonthsFromShortage(2_000_000), 3);
    assert.equal(cycleMonthsFromShortage(1_999_999), 4);
    assert.equal(cycleMonthsFromShortage(0), 6);
  });

  it("remaining amount", () => {
    assert.equal(computeRemainingAmount(5_000_000, 2_000_000), 3_000_000);
    assert.equal(computeRemainingAmount(1_000_000, 2_000_000), 0);
  });

  it("next revision date", () => {
    assert.equal(computeNextRevisionDate("2026-06-10", 3_000_000).nextRevisionDate, "2026-09-10");
    assert.equal(computeNextRevisionDate("2026-06-10", 500_000).nextRevisionDate, "2026-10-10");
    assert.equal(computeNextRevisionDate("2026-06-10", 0).nextRevisionDate, "2026-12-10");
  });

  it("add months end-of-month", () => {
    assert.equal(addMonthsYmd("2026-01-31", 1), "2026-02-28");
  });

  it("cycle statuses", () => {
    assert.equal(
      computeCycleStatus({ hasCompletedRevision: false, nextRevisionDate: null, today: "2026-09-17" }),
      "YANGI_OCHILGAN",
    );
    assert.equal(
      computeCycleStatus({
        hasCompletedRevision: true,
        nextRevisionDate: "2026-09-20",
        today: "2026-09-17",
        cycleMonths: 3,
      }),
      "TEZ_ORADA",
    );
    assert.equal(
      computeCycleStatus({
        hasCompletedRevision: true,
        nextRevisionDate: "2026-09-10",
        today: "2026-09-17",
        cycleMonths: 3,
      }),
      "MUDDATI_OTGAN",
    );
    assert.equal(
      computeCycleStatus({
        hasCompletedRevision: true,
        nextRevisionDate: "2026-03-10",
        today: "2026-09-17",
        cycleMonths: 3,
      }),
      "SIKL_OTKAZIB_YUBORILGAN",
    );
    assert.equal(
      computeCycleStatus({
        hasCompletedRevision: true,
        nextRevisionDate: "2027-01-01",
        today: "2026-09-17",
        cycleMonths: 6,
        workflowStatus: "IN_PROGRESS",
      }),
      "REVIZIYA_JARAYONIDA",
    );
  });
});
