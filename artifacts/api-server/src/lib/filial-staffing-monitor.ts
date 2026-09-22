import { inArray, sql } from "drizzle-orm";
import { db, employeesTable, staffingAlertsTable } from "@workspace/db";
import { displayBranchName, gpsFromLocationField, stripGpsSuffix } from "./geo-location";
import { districtFromGps, sortDistrictNames } from "./filial-districts";
import { loadFilialBranches } from "./filial-bot-data";
import { formatTashkent } from "./filial-bot-users";

const STATUS_LABEL: Record<string, string> = {
  new: "Yangi",
  dismissed: "Bo‘shatilgan",
  need_hire: "Xodim kerak",
  searching: "Qidirilmoqda",
  working: "Ishlamoqda",
  no_manager: "Mudir yo‘q",
  closed: "Yopilgan",
};

export type StaffNeedItem = {
  alertId: number;
  employeeId: number;
  employeeName: string;
  position: string | null;
  orgRole: string;
  roleLabel: string;
  branch: string;
  district: string;
  shift: string;
  status: string;
  statusLabel: string;
  workflowStatus: string;
  createdAt: Date;
  openedAtLabel: string;
  daysOpen: number;
  urgencyLabel: string;
  mudirName: string | null;
  mudirPhone: string | null;
  coordinatorName: string | null;
  coordinatorPhone: string | null;
  branchPhone: string | null;
  managerEmployeeId: number | null;
};

export type MonitorBucket = {
  key: string;
  label: string;
  count: number;
  pct: number;
};

export type StaffingMonitorReport = {
  generatedAt: Date;
  generatedAtLabel: string;
  totalNeeds: number;
  searchingCount: number;
  needHireCount: number;
  dismissedCount: number;
  okBranches: number;
  totalBranches: number;
  gapBranches: number;
  byDistrict: MonitorBucket[];
  byShift: MonitorBucket[];
  byStatus: MonitorBucket[];
  byRole: MonitorBucket[];
  topDistrict: MonitorBucket | null;
  topShift: MonitorBucket | null;
  items: StaffNeedItem[];
  critical: StaffNeedItem[];
  okBranchNames: string[];
  analysisLine: string;
};

function roleLabel(orgRole: string | null | undefined): string {
  if (orgRole === "manager") return "Mudir";
  if (orgRole === "intern") return "Stajyor";
  if (orgRole === "supervisor") return "Nazoratchi";
  if (orgRole === "pharmacist") return "Farmasevt";
  return orgRole || "Xodim";
}

export function formatShiftLabel(
  shiftLabel: string | null | undefined,
  shiftType: string | null | undefined,
): string {
  const raw = String(shiftLabel || shiftType || "").trim();
  if (!raw) return "Smena belgilanmagan";
  if (/smena|\+/i.test(raw)) return raw;
  if (raw === "two" || raw === "2") return "2-smena";
  if (raw === "three" || raw === "3") return "3-smena";
  if (raw === "one" || raw === "1") return "1-smena";
  if (raw === "office") return "Ofis";
  return raw;
}

function resolveDistrict(
  lat: number | null | undefined,
  lng: number | null | undefined,
  location: string | null | undefined,
  branchDistrictByName: Map<string, string>,
  branchName: string,
): string {
  const gps =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : gpsFromLocationField(location);
  if (gps) return districtFromGps(gps.lat, gps.lng);
  const fromCard = branchDistrictByName.get(branchName.toLowerCase());
  if (fromCard) return fromCard;
  return districtFromGps(null, null);
}

function branchLabel(location: string | null | undefined, fallbackName: string): string {
  const fromLoc = displayBranchName(location) || stripGpsSuffix(location);
  const generic = !fromLoc || /^(filial|apteka|branch|dorixona)\s*\d*$/i.test(fromLoc);
  return (generic ? fallbackName : fromLoc).trim() || fallbackName || "Filial";
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function bucketsFromMap(map: Map<string, number>, total: number, limit = 12): MonitorBucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({
      key,
      label: key,
      count,
      pct: pct(count, total),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "uz"))
    .slice(0, limit);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function urgencyLabel(days: number): string {
  if (days >= 30) return "KRITIK ≥30 kun";
  if (days >= 14) return "YUQORI ≥14 kun";
  if (days >= 7) return "O‘RTACHA ≥7 kun";
  return "YANGI";
}

/** Faqat haqiqiy yollash ehtiyoji — «bo‘shatilgan» hisobga olinmaydi */
const OPEN_NEED_STATUSES = new Set(["need_hire", "searching", "new"]);

export async function loadStaffingMonitorReport(): Promise<StaffingMonitorReport> {
  const [alerts, branches] = await Promise.all([
    db
      .select()
      .from(staffingAlertsTable)
      .where(inArray(staffingAlertsTable.workflowStatus, ["pending", "confirmed"]))
      .orderBy(sql`${staffingAlertsTable.createdAt} DESC`),
    loadFilialBranches(true),
  ]);

  const empIds = [...new Set(alerts.map((a) => a.employeeId))];
  const employees = empIds.length
    ? await db
        .select({
          id: employeesTable.id,
          fullName: employeesTable.fullName,
          position: employeesTable.position,
          orgRole: employeesTable.orgRole,
          location: employeesTable.location,
          latitude: employeesTable.latitude,
          longitude: employeesTable.longitude,
          shiftType: employeesTable.shiftType,
          shiftLabel: employeesTable.shiftLabel,
          employmentStatus: employeesTable.employmentStatus,
        })
        .from(employeesTable)
        .where(inArray(employeesTable.id, empIds))
    : [];
  const empById = new Map(employees.map((e) => [e.id, e]));

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const branchByName = new Map(branches.map((b) => [b.name.toLowerCase(), b]));
  const branchDistrictByName = new Map(branches.map((b) => [b.name.toLowerCase(), b.district]));

  const now = new Date();
  const items: StaffNeedItem[] = [];
  for (const a of alerts) {
    const emp = empById.get(a.employeeId);
    // To‘ldirilgan / yopilgan — hisobga olmaslik
    const liveStatus = emp?.employmentStatus || a.employmentStatus;
    if (liveStatus === "working" || liveStatus === "closed" || liveStatus === "no_manager") {
      continue;
    }
    const status = a.employmentStatus || liveStatus || "need_hire";
    if (!OPEN_NEED_STATUSES.has(status)) continue;

    const branch = branchLabel(a.branchLocation || emp?.location, emp?.fullName || "Filial");
    const card =
      (a.managerEmployeeId != null ? branchById.get(a.managerEmployeeId) : undefined) ||
      branchByName.get(branch.toLowerCase()) ||
      null;

    const district =
      card?.district ||
      resolveDistrict(
        emp?.latitude,
        emp?.longitude,
        a.branchLocation || emp?.location,
        branchDistrictByName,
        branch,
      );

    const createdAt = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
    const daysOpen = daysBetween(createdAt, now);

    items.push({
      alertId: a.id,
      employeeId: a.employeeId,
      employeeName: emp?.fullName || "Noma’lum",
      position: emp?.position ?? null,
      orgRole: emp?.orgRole || "pharmacist",
      roleLabel: roleLabel(emp?.orgRole),
      branch: card?.name || branch,
      district,
      shift: formatShiftLabel(a.shiftLabel || emp?.shiftLabel, a.shiftType || emp?.shiftType),
      status,
      statusLabel: STATUS_LABEL[status] ?? status,
      workflowStatus: a.workflowStatus,
      createdAt,
      openedAtLabel: formatTashkent(createdAt),
      daysOpen,
      urgencyLabel: urgencyLabel(daysOpen),
      mudirName: card?.mudirName ?? null,
      mudirPhone: card?.mudirPhone ?? null,
      coordinatorName: card?.coordinatorName ?? null,
      coordinatorPhone: card?.coordinatorPhone ?? null,
      branchPhone: card?.primaryPhone ?? null,
      managerEmployeeId: a.managerEmployeeId ?? card?.id ?? null,
    });
  }

  const totalNeeds = items.length;
  const byDistrictMap = new Map<string, number>();
  const byShiftMap = new Map<string, number>();
  const byStatusMap = new Map<string, number>();
  const byRoleMap = new Map<string, number>();
  const needBranchKeys = new Set<string>();

  for (const it of items) {
    byDistrictMap.set(it.district, (byDistrictMap.get(it.district) || 0) + 1);
    byShiftMap.set(it.shift, (byShiftMap.get(it.shift) || 0) + 1);
    byStatusMap.set(it.statusLabel, (byStatusMap.get(it.statusLabel) || 0) + 1);
    byRoleMap.set(it.roleLabel, (byRoleMap.get(it.roleLabel) || 0) + 1);
    needBranchKeys.add(it.branch.toLowerCase());
  }

  const byDistrict = bucketsFromMap(byDistrictMap, totalNeeds, 20);
  byDistrict.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return sortDistrictNames([a.label, b.label])[0] === a.label ? -1 : 1;
  });

  const byShift = bucketsFromMap(byShiftMap, totalNeeds, 10);
  const byStatus = bucketsFromMap(byStatusMap, totalNeeds, 10);
  const byRole = bucketsFromMap(byRoleMap, totalNeeds, 10);
  const topDistrict = byDistrict[0] ?? null;
  const topShift = byShift[0] ?? null;

  const okBranchNames = branches
    .filter((b) => !needBranchKeys.has(b.name.toLowerCase()))
    .map((b) => b.name)
    .sort((a, b) => a.localeCompare(b, "uz"));

  const gapBranches = branches.filter((b) => needBranchKeys.has(b.name.toLowerCase())).length;

  const analysisLine = totalNeeds
    ? topDistrict
      ? `«${topDistrict.label}» tumani barcha ehtiyojning ${topDistrict.pct}%ini tashkil etdi` +
        (topShift ? ` · Eng ko‘p: ${topShift.label} (${topShift.pct}%)` : "")
      : "Ehtiyojlar tumanlar bo‘yicha taqsimlangan"
    : "Hozir ochiq xodim ehtiyoji yo‘q — barcha filiallar to‘ldirilgan";

  const generatedAt = new Date();
  const criticalSorted = [...items].sort((a, b) => b.daysOpen - a.daysOpen).slice(0, 12);

  return {
    generatedAt,
    generatedAtLabel: formatTashkent(generatedAt),
    totalNeeds,
    searchingCount: items.filter((i) => i.status === "searching").length,
    needHireCount: items.filter((i) => i.status === "need_hire" || i.status === "new").length,
    dismissedCount: 0,
    okBranches: okBranchNames.length,
    totalBranches: branches.length,
    gapBranches,
    byDistrict,
    byShift,
    byStatus,
    byRole,
    topDistrict,
    topShift,
    items,
    critical: criticalSorted,
    okBranchNames,
    analysisLine,
  };
}

export function buildStaffingMonitorCaption(
  report: StaffingMonitorReport,
  opts?: { maxItems?: number },
): string {
  const maxItems = opts?.maxItems ?? 15;
  const lines: string[] = [
    "📊 <b>Vaksina — xodim ehtiyoji (jonli)</b>",
    `<i>${esc(report.generatedAtLabel)} (Toshkent)</i>`,
    "",
    `🔴 <b>Jami kerak:</b> ${report.totalNeeds}`,
    `🟡 <b>Qidirilmoqda:</b> ${report.searchingCount}`,
    `🟠 <b>Yollash kerak:</b> ${report.needHireCount}`,
    `🟢 <b>To‘liq filial:</b> ${report.okBranches}/${report.totalBranches}`,
    `⚠️ <b>Ehtiyojli filial:</b> ${report.gapBranches}`,
    "",
  ];

  if (report.byDistrict.length) {
    lines.push("<b>🗺 Tumanlar:</b>");
    for (const d of report.byDistrict.slice(0, 10)) {
      lines.push(`· ${esc(d.label)} — <b>${d.count}</b> (${d.pct}%)`);
    }
    lines.push("");
  }

  if (report.byShift.length) {
    lines.push("<b>🕐 Smenalar:</b>");
    for (const s of report.byShift.slice(0, 6)) {
      lines.push(`· ${esc(s.label)} — <b>${s.count}</b> (${s.pct}%)`);
    }
    lines.push("");
  }

  if (report.critical.length) {
    lines.push("<b>📍 Qayerda xodim kerak:</b>");
    report.critical.slice(0, maxItems).forEach((it, i) => {
      lines.push(
        `${i + 1}. <b>${esc(it.branch)}</b> · ${esc(it.district)}`,
        `   ${esc(it.roleLabel)} · ${esc(it.shift)} · ${esc(it.statusLabel)}`,
        `   ${esc(it.employeeName)}${it.position ? ` (${esc(it.position)})` : ""}`,
      );
    });
    if (report.items.length > maxItems) {
      lines.push(`<i>… yana ${report.items.length - maxItems} ta</i>`);
    }
    lines.push("");
  }

  lines.push(`💡 <i>${esc(report.analysisLine)}</i>`);
  lines.push("", "<i>Ma’lumotlar Aptekalar tarmog‘i / staffing alerts dan.</i>");
  return lines.join("\n");
}

export function buildDismissAlertText(opts: {
  branch: string;
  district: string;
  shift: string;
  roleLabel: string;
  employeeName: string;
  status: string;
}): string {
  const statusLabel = STATUS_LABEL[opts.status] ?? opts.status;
  return [
    "🚨 <b>Yangi xodim ehtiyoji</b>",
    "",
    `🏢 <b>Filial:</b> ${esc(opts.branch)}`,
    `🗺 <b>Tuman:</b> ${esc(opts.district)}`,
    `🕐 <b>Smena:</b> ${esc(opts.shift)}`,
    `👤 <b>Lavozim:</b> ${esc(opts.roleLabel)}`,
    `🧾 <b>Xodim:</b> ${esc(opts.employeeName)}`,
    `📌 <b>Holat:</b> ${esc(statusLabel)}`,
    "",
    "<i>Jonli monitoring: botda «📊 Ma’lumot» tugmasi</i>",
  ].join("\n");
}

export async function resolveEmployeePlace(employee: {
  fullName: string;
  location?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  orgRole?: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
  branchLocation?: string | null;
}): Promise<{ branch: string; district: string; shift: string; roleLabel: string }> {
  const branches = await loadFilialBranches();
  const branch = branchLabel(employee.branchLocation || employee.location, employee.fullName);
  const branchDistrictByName = new Map(branches.map((b) => [b.name.toLowerCase(), b.district]));
  const district = resolveDistrict(
    employee.latitude,
    employee.longitude,
    employee.branchLocation || employee.location,
    branchDistrictByName,
    branch,
  );
  return {
    branch,
    district,
    shift: formatShiftLabel(employee.shiftLabel, employee.shiftType),
    roleLabel: roleLabel(employee.orgRole),
  };
}

export type BranchNeedGroup = {
  branch: string;
  district: string;
  total: number;
  byRole: Array<{ label: string; count: number }>;
  byShift: Array<{ label: string; count: number }>;
  items: StaffNeedItem[];
};

/** Filial nomlari bo‘yicha guruhlash — rekruter ro‘yxati uchun */
export function groupNeedsByBranch(items: StaffNeedItem[]): BranchNeedGroup[] {
  const map = new Map<string, StaffNeedItem[]>();
  for (const it of items) {
    const key = it.branch.trim().toLowerCase() || "filial";
    const arr = map.get(key) || [];
    arr.push(it);
    map.set(key, arr);
  }

  const groups: BranchNeedGroup[] = [];
  for (const [, list] of map) {
    const branch = list[0]!.branch;
    const district = list[0]!.district;
    const roleMap = new Map<string, number>();
    const shiftMap = new Map<string, number>();
    for (const it of list) {
      roleMap.set(it.roleLabel, (roleMap.get(it.roleLabel) || 0) + 1);
      shiftMap.set(it.shift, (shiftMap.get(it.shift) || 0) + 1);
    }
    const roleOrder = ["Mudir", "Farmasevt", "Stajyor", "Nazoratchi"];
    const byRole = [...roleMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        const ia = roleOrder.indexOf(a.label);
        const ib = roleOrder.indexOf(b.label);
        if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return b.count - a.count;
      });
    const byShift = [...shiftMap.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "uz"));

    groups.push({
      branch,
      district,
      total: list.length,
      byRole,
      byShift,
      items: list.sort((a, b) => a.roleLabel.localeCompare(b.roleLabel, "uz")),
    });
  }

  return groups.sort((a, b) => b.total - a.total || a.branch.localeCompare(b.branch, "uz"));
}

export function formatBranchNeedDetail(g: BranchNeedGroup): string {
  const lines: string[] = [
    `🏢 <b>${esc(g.branch)}</b>`,
    `🗺 <b>Tuman:</b> ${esc(g.district)}`,
    `🔴 <b>Jami xodim kerak:</b> ${g.total}`,
    "",
    "<b>Lavozim bo‘yicha:</b>",
  ];
  for (const r of g.byRole) {
    lines.push(`· ${esc(r.label)} — <b>${r.count}</b> ta`);
  }
  lines.push("", "<b>Smena bo‘yicha:</b>");
  for (const s of g.byShift) {
    lines.push(`· ${esc(s.label)} — <b>${s.count}</b> ta`);
  }
  lines.push("", "<b>To‘liq ro‘yxat:</b>");
  g.items.forEach((it, i) => {
    lines.push(
      `${i + 1}. <b>${esc(it.roleLabel)}</b> · ${esc(it.shift)} · ${esc(it.statusLabel)}`,
      `   👤 ${esc(it.employeeName)}${it.position ? ` · ${esc(it.position)}` : ""}`,
    );
  });
  return lines.join("\n");
}

export function formatNeedBranchesSummary(groups: BranchNeedGroup[]): string {
  const total = groups.reduce((s, g) => s + g.total, 0);
  return [
    "🔴 <b>Xodim kerak — filiallar</b>",
    "",
    `Filial: <b>${groups.length}</b> · Ehtiyoj: <b>${total}</b>`,
    "Filial nomini bosing — kim / qaysi smena / mudir·farmasevt·stajyor chiqadi.",
  ].join("\n");
}

