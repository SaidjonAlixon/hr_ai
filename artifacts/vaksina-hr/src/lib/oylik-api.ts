import { isDirectorRole } from "./roles";
import { datesFromTo, resolveDay, weekdayShort, type SwapDayFigure as SwapDay } from "./oylik-period";
import { displayBranchName } from "./pharmacy-staff-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type PayrollReport = {
  userId: number;
  employeeId: number | null;
  month: string;
  monthLabel: string;
  from: string;
  to: string;
  fullName: string;
  role: string;
  roleLabel: string;
  position: string | null;
  branch: string | null;
  fixedSalary: number;
  bonusPercent: number;
  attendance: {
    available: boolean;
    complete?: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    points: number;
    countedDays: number;
    expectedDays?: number;
    closedDays?: number;
    days: Array<{ date: string; status: string; lateMinutes: number | null; counted: boolean; points: number; note: string }>;
  };
  tasks: {
    available: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    points: number;
    total: number;
    items: Array<{ id: number; title: string; points: number; label: string }>;
  };
  checklist: {
    available: boolean;
    percent: number;
    baseWeight: number;
    effectiveWeight: number;
    items: Array<{ id: number; visitDate: string; visitName: string; percent: number; yesCount: number; totalCount: number }>;
  };
  kpiPercent: number;
  maxBonus: number;
  bonusAmount: number;
  totalAmount: number;
  status?: "draft" | "approved";
};

export type PayrollRow = {
  employeeId?: number;
  userId: number | null;
  fullName: string;
  roleLabel: string;
  userRole?: string | null;
  orgRole?: string | null;
  departmentName?: string | null;
  position: string | null;
  branch: string | null;
  shiftType?: string | null;
  shiftLabel?: string | null;
  calendarScope?: string | null;
  salary?: number;
  jarima?: number;
  jarimaNote?: string | null;
  jarimaEvents?: Array<{ date: string; kind: "late" | "absent"; n: number; amount: number }>;
  jarimaLocked?: boolean;
  returnedDays?: Array<{ date: string; salary: number; jarima: number }>;
  swapDays?: SwapDay[];
  daySheets?: Array<{
    day: string;
    salary: number | null;
    jarima: number | null;
    note: string | null;
    manual: boolean;
    status: "draft" | "approved" | "returned";
    publishedSalary: number | null;
    publishedJarima: number | null;
    publishedNote: string | null;
  }>;
  fixedSalary: number;
  bonusPercent: number;
  kpiPercent: number;
  bonusAmount: number;
  totalAmount: number;
  status: string;
  attendance: number;
  tasks: number;
  checklist: number;
  attendanceAvailable: boolean;
  attendanceComplete?: boolean;
  expectedWorkDays?: number;
  closedWorkDays?: number;
  tasksAvailable: boolean;
  checklistAvailable: boolean;
};

export function payrollRowKey(r: { employeeId?: number | null; userId?: number | null }) {
  return r.employeeId || r.userId || 0;
}

function emptyPart() {
  return {
    available: false,
    percent: 0,
    baseWeight: 0,
    effectiveWeight: 0,
    points: 0,
    countedDays: 0,
    total: 0,
    days: [] as PayrollReport["attendance"]["days"],
    items: [] as never[],
  };
}

function normalizeReport(raw: Record<string, unknown>): PayrollReport {
  const att = (raw.attendance as PayrollReport["attendance"] | undefined) ?? {
    ...emptyPart(),
    days: [],
  };
  const tasks = (raw.tasks as PayrollReport["tasks"] | undefined) ?? {
    available: false,
    percent: 0,
    baseWeight: 0,
    effectiveWeight: 0,
    points: 0,
    total: 0,
    items: [],
  };
  const checklist = (raw.checklist as PayrollReport["checklist"] | undefined) ?? {
    available: false,
    percent: 0,
    baseWeight: 0,
    effectiveWeight: 0,
    items: [],
  };
  return {
    userId: Number(raw.userId ?? 0),
    employeeId: (raw.employeeId as number | null) ?? null,
    month: String(raw.month ?? ""),
    monthLabel: String(raw.monthLabel ?? raw.month ?? ""),
    from: String(raw.from ?? ""),
    to: String(raw.to ?? ""),
    fullName: String(raw.fullName ?? ""),
    role: String(raw.role ?? ""),
    roleLabel: String(raw.roleLabel ?? ""),
    position: (raw.position as string | null) ?? null,
    branch: (raw.branch as string | null) ?? null,
    fixedSalary: Number(raw.fixedSalary ?? 0),
    bonusPercent: Number(raw.bonusPercent ?? 0),
    attendance: { ...att, days: att.days ?? [] },
    tasks: { ...tasks, items: tasks.items ?? [] },
    checklist: { ...checklist, items: checklist.items ?? [] },
    kpiPercent: Number(raw.kpiPercent ?? 0),
    maxBonus: Number(raw.maxBonus ?? 0),
    bonusAmount: Number(raw.bonusAmount ?? raw.bonus ?? 0),
    totalAmount: Number(raw.totalAmount ?? raw.netSalary ?? 0),
    status: (raw.status as "draft" | "approved") || "draft",
  };
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let message = "Xatolik";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

export type PayrollSlip = {
  approved: boolean;
  returned?: boolean;
  status?: "approved" | "returned" | "draft";
  month: string;
  fullName: string;
  salary?: number;
  jarima?: number;
  note?: string | null;
  net?: number;
};

export type PayrollYearMonth = {
  month: string;
  status: string;
  salary: number;
  jarima: number;
  net: number;
};

export type MyPayrollDay = {
  date: string;
  salary: number;
  jarima: number;
  kind: "late" | "absent" | null;
  n: number;
  note: string;
};

export function useMyPayrollCard(month: string, enabled = true) {
  return useQuery({
    queryKey: ["oylik", "my-card", month],
    queryFn: () =>
      json<{ month: string; monthLabel: string; salary: number; days: MyPayrollDay[] }>(
        `/api/oylik/my-card?month=${encodeURIComponent(month)}`,
      ),
    enabled,
    staleTime: 20_000,
  });
}

export function useOylikSlip(month: string, enabled = true) {
  return useQuery({
    queryKey: ["oylik", "slip", month],
    queryFn: () => json<PayrollSlip>(`/api/oylik/slip?month=${encodeURIComponent(month)}`),
    enabled,
    staleTime: 20_000,
  });
}

export function useOylikYear(year: string, enabled = true) {
  return useQuery({
    queryKey: ["oylik", "year", year],
    queryFn: () =>
      json<{ year: string; months: PayrollYearMonth[]; approvedNet: number }>(
        `/api/oylik/year?year=${encodeURIComponent(year)}`,
      ),
    enabled,
    staleTime: 20_000,
  });
}

export function useSaveOylikDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { userId: number; employeeId?: number; day: string; salary: number; jarima: number; note?: string }) =>
      json("/api/oylik/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useApproveOylikDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; day: string; userIds: number[] }) =>
      json("/api/oylik/day/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useRefreshOylikDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; day: string; userIds: number[] }) =>
      json("/api/oylik/day/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useReturnOylik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; userIds: number[]; day: string }) =>
      json("/api/oylik/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export type JarimaEvent = {
  date: string;
  kind: "late" | "absent";
  n: number;
  amount: number;
};

export type JarimaSelf = {
  fullName: string;
  position?: string | null;
  branch?: string | null;
  shift?: string | null;
  salary: number;
  strikes: number;
  late: number;
  absent: number;
  amount: number;
  events?: JarimaEvent[];
  note: string | null;
  status: string;
};

export function useJarimaSummary(month: string) {
  return useQuery({
    queryKey: ["oylik", "jarima", month],
    queryFn: () =>
      json<{
        month: string;
        own: boolean;
        approved: boolean;
        people: number;
        total: number;
        active?: boolean;
        start?: string;
        rule?: string[];
        self?: JarimaSelf | null;
        rows?: JarimaSelf[];
      }>(`/api/oylik/jarima-summary?month=${encodeURIComponent(month)}`),
    staleTime: 20_000,
  });
}

export function useSaveOylikFiksa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; lines: Array<{ userId: number; employeeId?: number; salary: number }> }) =>
      json<{ ok: boolean; saved: number }>("/api/oylik/fiksa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useSaveOylikLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { userId: number; employeeId?: number; month: string; salary: number; jarima: number; note?: string }) =>
      json("/api/oylik/line", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useOylikMe(month?: string) {
  const q = month ? `?month=${encodeURIComponent(month)}` : "";
  return useQuery({
    queryKey: ["oylik", "me", month ?? "current"],
    queryFn: async () => normalizeReport(await json<Record<string, unknown>>(`/api/oylik/me${q}`)),
    staleTime: 30_000,
  });
}

export function useOylikSettings(enabled: boolean) {
  return useQuery({
    queryKey: ["oylik", "settings"],
    queryFn: () =>
      json<{
        weights: { attendance: number; tasks: number; checklist: number; workStartHm: string };
        canEdit: boolean;
        canApprove: boolean;
      }>("/api/oylik/settings"),
    enabled,
  });
}

export function useOylikEmployees(month: string, q: string, enabled: boolean) {
  const qs = new URLSearchParams({ month });
  if (q.trim()) qs.set("q", q.trim());
  return useQuery({
    queryKey: ["oylik", "employees", month, q],
    queryFn: () =>
      json<{ month: string; workDays?: string[]; calendars?: Record<string, string[]>; items: PayrollRow[] }>(
        `/api/oylik/employees?${qs}`,
      ),
    enabled,
    staleTime: 20_000,
  });
}

export function useOylikEmployee(userId: number | null, month: string) {
  return useQuery({
    queryKey: ["oylik", "employee", userId, month],
    queryFn: async () =>
      normalizeReport(await json<Record<string, unknown>>(`/api/oylik/employees/${userId}?month=${encodeURIComponent(month)}`)),
    enabled: userId != null,
  });
}

export function useSaveOylikSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { attendance?: number; tasks?: number; checklist?: number }) =>
      json("/api/oylik/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useSaveSalary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { userId: number; employeeId?: number; month: string; fixedSalary?: number; bonusPercent?: number }) =>
      json(`/api/oylik/salary/${p.userId || p.employeeId || 0}?month=${encodeURIComponent(p.month)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: p.employeeId,
          fixedSalary: p.fixedSalary,
          bonusPercent: p.bonusPercent,
        }),
      }),
    onSuccess: (_data, p) => {
      void qc.invalidateQueries({ queryKey: ["oylik", "employees"], exact: false });
      void qc.invalidateQueries({ queryKey: ["oylik", "employee", p.userId, p.month] });
    },
  });
}

export function useSaveSalaryBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; position: string; fixedSalary?: number; bonusPercent?: number }) =>
      json("/api/oylik/salary-bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: p.month,
          position: p.position,
          fixedSalary: p.fixedSalary,
          bonusPercent: p.bonusPercent,
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useRecalculateOylik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { month: string; userId?: number }) =>
      json("/api/oylik/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

export function useToggleWorkDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { day: string; isWork: boolean; scope: string }) =>
      json<{ ok: boolean; day: string; isWork: boolean; scope: string; workDays: string[] }>("/api/oylik/calendar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
      void qc.invalidateQueries({ queryKey: ["work-calendar"] });
    },
  });
}

export function useApproveOylik() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { userId?: number; month: string; all?: boolean; position?: string; userIds?: number[] }) =>
      json("/api/oylik/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["oylik"] });
    },
  });
}

function excelCell(value: string | number, type: "String" | "Number", style?: string, opts?: { mergeAcross?: number; mergeDown?: number; index?: number }) {
  const attrs = [
    opts?.index ? ` ss:Index="${opts.index}"` : "",
    style ? ` ss:StyleID="${style}"` : "",
    opts?.mergeAcross ? ` ss:MergeAcross="${opts.mergeAcross}"` : "",
    opts?.mergeDown ? ` ss:MergeDown="${opts.mergeDown}"` : "",
  ].join("");
  return `<Cell${attrs}><Data ss:Type="${type}">${String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;")}</Data></Cell>`;
}

function excelCols(widths: number[]) {
  return widths.map((width, index) => `<Column ss:Index="${index + 1}" ss:AutoFitWidth="0" ss:Width="${width}"/>`).join("");
}

function excelRow(cells: string, height?: number) {
  const size = height ? ` ss:AutoFitHeight="0" ss:Height="${height}"` : "";
  return `<Row${size}>${cells}</Row>`;
}

function filialName(raw: string | null | undefined) {
  return displayBranchName(raw).trim();
}

function excelDateLabel(ymd: string) {
  const [year, month, day] = ymd.split("-");
  return `${day}.${month}.${year}`;
}

const BORDER = `<Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/></Borders>`;
const DAY_LEFT = `<Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0B3A5C"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/></Borders>`;
const DAY_RIGHT = `<Borders><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#0B3A5C"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CBD5E1"/></Borders>`;

function dayStatusWord(status: string) {
  if (status === "approved") return "Tasdiq";
  if (status === "returned") return "Qaytgan";
  return "Kutiladi";
}

function dayStatusStyle(status: string, jarima: number) {
  if (status === "returned") return "stBack";
  if (status === "approved") return "stOk";
  if (jarima > 0) return "stFine";
  return "stWait";
}

const EXCEL_STYLES = `<Styles>
<Style ss:ID="title"><Font ss:FontName="Calibri" ss:Size="13" ss:Bold="1" ss:Color="#0B3A5C"/><Alignment ss:Vertical="Center"/></Style>
<Style ss:ID="note"><Font ss:FontName="Calibri" ss:Size="10" ss:Color="#475569"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="head"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${BORDER}</Style>
<Style ss:ID="headDay"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3A5C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${DAY_LEFT}</Style>
<Style ss:ID="headJar"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7F1D1D" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${DAY_LEFT}</Style>
<Style ss:ID="sub"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#164E73" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>${DAY_LEFT}</Style>
<Style ss:ID="subBlue"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#DBEAFE"/><Interior ss:Color="#1D4ED8" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${BORDER}</Style>
<Style ss:ID="subGreen"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#D1FAE5"/><Interior ss:Color="#047857" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${BORDER}</Style>
<Style ss:ID="subRose"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#FFE4E6"/><Interior ss:Color="#BE123C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${DAY_RIGHT}</Style>
<Style ss:ID="name"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#0F2744"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Left" ss:ShrinkToFit="0"/>${BORDER}</Style>
<Style ss:ID="text"><Font ss:FontName="Calibri" ss:Size="10" ss:Color="#334155"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Left" ss:ShrinkToFit="0"/>${BORDER}</Style>
<Style ss:ID="blue"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#1D4ED8"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${BORDER}</Style>
<Style ss:ID="green"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#047857"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${BORDER}</Style>
<Style ss:ID="rose"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#E11D48"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${DAY_RIGHT}</Style>
<Style ss:ID="stWait"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#92400E"/><Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${DAY_LEFT}</Style>
<Style ss:ID="stOk"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#065F46"/><Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${DAY_LEFT}</Style>
<Style ss:ID="stBack"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#9F1239"/><Interior ss:Color="#FFE4E6" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${DAY_LEFT}</Style>
<Style ss:ID="stFine"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#9A3412"/><Interior ss:Color="#FFEDD5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/>${DAY_LEFT}</Style>
<Style ss:ID="foot"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#0F2744"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:Horizontal="Left" ss:ShrinkToFit="0"/>${BORDER}</Style>
<Style ss:ID="footDay"><Font ss:FontName="Calibri" ss:Size="9" ss:Bold="1" ss:Color="#0F2744"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>${DAY_LEFT}</Style>
<Style ss:ID="footNum"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#0F2744"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${BORDER}</Style>
<Style ss:ID="footRose"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#9F1239"/><Interior ss:Color="#FFE4E6" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${DAY_RIGHT}</Style>
<Style ss:ID="total"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#7F1D1D" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${DAY_LEFT}</Style>
<Style ss:ID="totalGreen"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#047857" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:Vertical="Center"/><NumberFormat ss:Format="#,##0"/>${BORDER}</Style>
</Styles>`;

export async function downloadOylikViewExcel(input: {
  month: string;
  filterLine: string;
  rows: PayrollRow[];
  grain: "kun" | "hafta" | "oy";
  from: string;
  to: string;
  fileName?: string;
}): Promise<void> {
  const rowsXml = input.grain === "kun" ? kunSheetRows(input) : boardSheetRows(input);
  const sheetName = input.grain === "kun" ? "Kun" : input.grain === "hafta" ? "Hafta" : "Oy";
  const headerRows = input.grain === "kun" ? 3 : 4;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${EXCEL_STYLES}
<Worksheet ss:Name="${sheetName}"><Table>
${rowsXml}
</Table>
<x:WorksheetOptions>
<x:FreezePanes/>
<x:FrozenNoSplit/>
<x:SplitHorizontal>${headerRows}</x:SplitHorizontal>
<x:TopRowBottomPane>${headerRows}</x:TopRowBottomPane>
<x:SplitVertical>4</x:SplitVertical>
<x:LeftColumnRightPane>4</x:LeftColumnRightPane>
<x:ActivePane>0</x:ActivePane>
<x:Panes>
<x:Pane><x:Number>3</x:Number></x:Pane>
<x:Pane><x:Number>1</x:Number></x:Pane>
<x:Pane><x:Number>2</x:Number></x:Pane>
<x:Pane><x:Number>0</x:Number><x:ActiveRow>${headerRows}</x:ActiveRow><x:ActiveCol>4</x:ActiveCol></x:Pane>
</x:Panes>
</x:WorksheetOptions>
</Worksheet></Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const { deliverFile } = await import("./tg-download");
  await deliverFile(blob, input.fileName || `oylik-${input.month}.xls`);
}

function kunSheetRows(input: { filterLine: string; rows: PayrollRow[]; month: string; from: string }) {
  const head = ["№", "Xodim", "Lavozim", "Filial", "Kunlik", "Jarima", "Izoh", "Qo‘lda qoladi", "Holat"];
  let salary = 0;
  let jarima = 0;
  let net = 0;
  const body = input.rows.map((row, index) => {
    const day = resolveDay(row, input.month, input.from);
    const left = day.salary - day.jarima;
    salary += day.salary;
    jarima += day.jarima;
    net += left;
    const cells = [
      excelCell(index + 1, "Number", "text"),
      excelCell(row.fullName, "String", "name"),
      excelCell(row.position || row.roleLabel || "", "String", "text"),
      excelCell(filialName(row.branch), "String", "text"),
      excelCell(day.salary, "Number", "blue"),
      excelCell(day.jarima, "Number", "rose"),
      excelCell(day.note || "", "String", "text"),
      excelCell(left, "Number", "green"),
      excelCell(dayStatusWord(day.status), "String", dayStatusStyle(day.status, day.jarima)),
    ];
    return excelRow(cells.join(""), 22);
  });
  const foot = excelRow([
    excelCell("", "String", "foot"),
    excelCell("Jami", "String", "foot"),
    excelCell("", "String", "foot"),
    excelCell(`${input.rows.length} xodim`, "String", "foot"),
    excelCell(salary, "Number", "totalGreen"),
    excelCell(jarima, "Number", "total"),
    excelCell("", "String", "foot"),
    excelCell(net, "Number", "totalGreen"),
    excelCell("", "String", "foot"),
  ].join(""), 28);
  return [
    excelCols([42, 190, 150, 160, 90, 80, 220, 110, 90]),
    excelRow(excelCell(`${excelDateLabel(input.from)} · ${input.filterLine}`, "String", "title", { mergeAcross: head.length - 1 }), 24),
    excelRow(excelCell("Kun jadvali. Ko‘k — kunlik, yashil — qo‘lda qoladi, qizil — jarima.", "String", "note", { mergeAcross: head.length - 1 }), 20),
    excelRow(head.map((cell, index) => excelCell(cell, "String", index === 5 ? "headJar" : "head")).join(""), 24),
    ...body,
    foot,
  ].join("");
}

function boardSheetRows(input: { filterLine: string; rows: PayrollRow[]; month: string; from: string; to: string; grain: "kun" | "hafta" | "oy" }) {
  const dates = datesFromTo(input.from, input.to);
  const fixed = 4;
  const width = fixed + dates.length * 4 + 3;
  const scopeLabel = input.grain === "oy" ? "Shu oy" : "Shu hafta";
  const headTop = [
    excelCell("№", "String", "head", { mergeDown: 1 }),
    excelCell("Xodim", "String", "head", { mergeDown: 1 }),
    excelCell("Lavozim", "String", "head", { mergeDown: 1 }),
    excelCell("Filial", "String", "head", { mergeDown: 1 }),
    ...dates.map((date, index) => excelCell(`${excelDateLabel(date)}\n${weekdayShort(date)}`, "String", "headDay", { mergeAcross: 3, index: index === 0 ? fixed + 1 : undefined })),
    excelCell("Jami jarima", "String", "headJar", { mergeDown: 1, index: fixed + dates.length * 4 + 1 }),
    excelCell("Qo‘lda qoladi", "String", "head", { mergeDown: 1 }),
    excelCell("Jarima kunlari", "String", "headJar", { mergeDown: 1 }),
  ];
  const headSub = dates.flatMap(() => [
    excelCell("Holat", "String", "sub"),
    excelCell("Kunlik", "String", "subBlue"),
    excelCell("Qolgan", "String", "subGreen"),
    excelCell("Jarima", "String", "subRose"),
  ]);
  const daySums = dates.map(() => ({ salary: 0, left: 0, jarima: 0, approved: 0, waiting: 0, returned: 0 }));
  let jarimaAll = 0;
  let netAll = 0;
  const body = input.rows.map((row, index) => {
    const cells = dates.map((date) => resolveDay(row, input.month, date));
    const jarima = cells.reduce((sum, cell) => sum + cell.jarima, 0);
    const net = cells.reduce((sum, cell) => sum + cell.salary - cell.jarima, 0);
    const finedDays = cells.filter((cell) => cell.jarima > 0).length;
    jarimaAll += jarima;
    netAll += net;
    const dayCells = cells.flatMap((cell, dayIndex) => {
      const left = cell.salary - cell.jarima;
      const bucket = daySums[dayIndex]!;
      bucket.salary += cell.salary;
      bucket.left += left;
      bucket.jarima += cell.jarima;
      if (cell.status === "approved") bucket.approved += 1;
      else if (cell.status === "returned") bucket.returned += 1;
      else bucket.waiting += 1;
      return [
        excelCell(dayStatusWord(cell.status), "String", dayStatusStyle(cell.status, cell.jarima)),
        excelCell(cell.salary, "Number", "blue"),
        excelCell(left, "Number", "green"),
        excelCell(cell.jarima, "Number", "rose"),
      ];
    });
    return excelRow([
      excelCell(index + 1, "Number", "text"),
      excelCell(row.fullName, "String", "name"),
      excelCell(row.position || row.roleLabel || "", "String", "text"),
      excelCell(filialName(row.branch), "String", "text"),
      ...dayCells,
      excelCell(jarima, "Number", "rose"),
      excelCell(net, "Number", "green"),
      excelCell(finedDays, "Number", "text"),
    ].join(""), 22);
  });
  const footDays = daySums.flatMap((bucket) => [
    excelCell(`Tasdiq: ${bucket.approved}\nKutiladi: ${bucket.waiting}\nQaytgan: ${bucket.returned}`, "String", "footDay"),
    excelCell(bucket.salary, "Number", "footNum"),
    excelCell(bucket.left, "Number", "footNum"),
    excelCell(bucket.jarima, "Number", "footRose"),
  ]);
  const foot = excelRow([
    excelCell("", "String", "foot"),
    excelCell("Jami", "String", "foot"),
    excelCell(scopeLabel, "String", "foot"),
    excelCell(`${input.rows.length} xodim`, "String", "foot"),
    ...footDays,
    excelCell(jarimaAll, "Number", "total"),
    excelCell(netAll, "Number", "totalGreen"),
    excelCell("", "String", "foot"),
  ].join(""), 52);
  const widths = [46, 200, 160, 170];
  for (let i = 0; i < dates.length; i += 1) widths.push(84, 78, 78, 72);
  widths.push(110, 120, 100);
  return [
    excelCols(widths),
    excelRow(excelCell(input.filterLine, "String", "title", { mergeAcross: width - 1 }), 24),
    excelRow(excelCell("Har kun alohida: holat, ko‘k kunlik, yashil qolgan, qizil jarima. Chap 4 ustun qotadi. Oxirida jami.", "String", "note", { mergeAcross: width - 1 }), 20),
    excelRow(headTop.join(""), 36),
    excelRow(`${excelCell("Holat", "String", "sub", { index: fixed + 1 })}${headSub.slice(1).join("")}`, 22),
    ...body,
    foot,
  ].join("");
}

export async function downloadOylikExcel(month: string): Promise<void> {
  const res = await fetch(`/api/oylik/export?month=${encodeURIComponent(month)}`, {
    credentials: "include",
  });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || type.includes("application/json")) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || "Excel yuklanmadi");
  }
  const blob = await res.blob();
  const { deliverFile } = await import("./tg-download");
  await deliverFile(blob, `oylik-kpi-${month}.xlsx`);
}

export { formatSom } from "@/lib/money";

export function monthLabelUz(ym: string, locale: "uz" | "ru" = "uz") {
  const namesUz = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
  const namesRu = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const names = locale === "ru" ? namesRu : namesUz;
  const [y, m] = (ym || "").split("-").map(Number);
  if (!y || !m) return ym;
  return `${names[m - 1]} ${y}`;
}

export function currentMonthKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

export function shiftMonthKey(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function canManagePayroll(role?: string | null) {
  return role === "admin" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar" || role === "hr_direktor" || role === "hr_kadr_rahbar";
}

export function canApprovePayroll(role?: string | null) {
  return role === "admin" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar";
}

export function canEditKpiSettings(role?: string | null) {
  return role === "admin" || role === "hr_direktor" || role === "hr_kadr_rahbar" || isDirectorRole(role) || role === "moliya" || role === "moliya_rahbar";
}
