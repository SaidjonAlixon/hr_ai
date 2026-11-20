import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWarehouseDavomatStatus,
  WH_LABEL_EVENING,
  WH_LABEL_MORNING,
  WH_LABEL_ONDUTY,
  WH_STATUS_EVENING,
  WH_STATUS_MORNING,
  WH_STATUS_ONDUTY,
} from "./warehouse-davomat-status";

describe("resolveWarehouseDavomatStatus", () => {
  it("kelmagan → kechgi smena", () => {
    const r = resolveWarehouseDavomatStatus(null);
    assert.equal(r.status, WH_STATUS_EVENING);
    assert.equal(r.label, WH_LABEL_EVENING);
  });

  it("09:30 gacha → ertalabki smena", () => {
    assert.equal(resolveWarehouseDavomatStatus("08:15").status, WH_STATUS_MORNING);
    assert.equal(resolveWarehouseDavomatStatus("09:30").status, WH_STATUS_MORNING);
    assert.equal(resolveWarehouseDavomatStatus("09:30").label, WH_LABEL_MORNING);
  });

  it("09:30 dan keyin → kechgi smena", () => {
    assert.equal(resolveWarehouseDavomatStatus("09:31").status, WH_STATUS_EVENING);
    assert.equal(resolveWarehouseDavomatStatus("14:00").status, WH_STATUS_EVENING);
    assert.equal(resolveWarehouseDavomatStatus("17:59").label, WH_LABEL_EVENING);
  });

  it("18:00 dan keyin → ishda", () => {
    assert.equal(resolveWarehouseDavomatStatus("18:00").status, WH_STATUS_ONDUTY);
    assert.equal(resolveWarehouseDavomatStatus("20:45").status, WH_STATUS_ONDUTY);
    assert.equal(resolveWarehouseDavomatStatus("22:10").label, WH_LABEL_ONDUTY);
  });
});
