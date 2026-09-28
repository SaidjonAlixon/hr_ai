import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeSecurityShiftType,
  isSecurityRestDay,
  parseSecurityShift,
  securityShiftFor,
} from "./security-shifts.ts";
import { addDaysYmd } from "./attendance-engine.ts";

describe("Xavfsizlik 24 soatlik smena", () => {
  it("SB boshlig‘i: dushanba–shanba ish, yakshanba dam", () => {
    const sb = parseSecurityShift("sb:09:00-09:00:mon-sat")!;
    assert.equal(sb.start, "09:00");
    assert.equal(sb.end, "09:00");
    // 2026-09-28 dushanba … 2026-10-04 yakshanba
    const days = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"];
    for (const d of days) assert.equal(isSecurityRestDay(d, sb.pattern), false, d);
    assert.equal(isSecurityRestDay("2026-10-04", sb.pattern), true);
  });

  it("Operatorlar kun ora almashadi", () => {
    const xoldor = parseSecurityShift("sb:09:00-09:00:alt:2026-09-28")!.pattern;
    const mansur = parseSecurityShift("sb:09:00-09:00:alt:2026-09-29")!.pattern;
    for (const d of ["2026-09-28", "2026-09-30", "2026-10-02", "2026-11-01"]) {
      assert.equal(isSecurityRestDay(d, xoldor), false, `xoldor ${d}`);
      assert.equal(isSecurityRestDay(d, mansur), true, `mansur ${d}`);
    }
    for (const d of ["2026-09-29", "2026-10-01", "2026-09-27"]) {
      assert.equal(isSecurityRestDay(d, xoldor), true, `xoldor ${d}`);
      assert.equal(isSecurityRestDay(d, mansur), false, `mansur ${d}`);
    }
  });

  it("Kod yo‘q SB roli — standart du–sha", () => {
    const sb = securityShiftFor({ userRole: "sb_boshliq", shiftType: "one" })!;
    assert.equal(sb.pattern.kind, "mon-sat");
    assert.equal(sb.start, "09:00");
    assert.equal(sb.end, "09:00");
    assert.equal(securityShiftFor({ userRole: "farmasevt", shiftType: "one" }), null);
  });

  it("encode ↔ parse", () => {
    const code = encodeSecurityShiftType({ pattern: { kind: "alt", anchor: "2026-09-28" } });
    assert.equal(code, "sb:09:00-09:00:alt:2026-09-28");
    assert.deepEqual(parseSecurityShift(code)!.pattern, { kind: "alt", anchor: "2026-09-28" });
  });

  it("Ketdim muddati — ertasi kun 11:00 (tugash 09:00 + 2 soat)", () => {
    const endAt = new Date(`${addDaysYmd("2026-09-28", 1)}T09:00:00+05:00`);
    const deadline = new Date(endAt.getTime() + 2 * 60 * 60 * 1000);
    assert.equal(deadline.toISOString(), new Date("2026-09-29T11:00:00+05:00").toISOString());
  });
});
