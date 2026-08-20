import React, { useMemo, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { canViewHolat } from "../../lib/roles";
import {
  downloadHolatExcel,
  useHolat,
  type HolatCoordNode,
  type HolatExcelSection,
  type HolatMudirNode,
  type HolatReport,
} from "../../lib/holat-api";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { HolatDashboardPanel } from "./holat-dashboard";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Phone,
  Search,
  Store,
} from "lucide-react";
import { useToast } from "../../hooks/use-toast";
import { cn } from "../../lib/utils";

function matchesQuery(parts: Array<string | null | undefined>, q: string) {
  if (!q) return true;
  return parts.filter(Boolean).join(" ").toLowerCase().includes(q);
}

export default function AdminHolatPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const allowed = canViewHolat(user?.role);
  const { data, isLoading, error, refetch } = useHolat(allowed);
  const [tab, setTab] = useState("sonlar");
  const [q, setQ] = useState("");
  const [branchQ, setBranchQ] = useState("");
  const [branchSide, setBranchSide] = useState<"with" | "without">("without");
  const [openId, setOpenId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<HolatExcelSection | null>(null);
  const [dashCoordKey, setDashCoordKey] = useState<string>("");

  const filteredCoords = useMemo(() => {
    const list = data?.coordinators ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((c) =>
      matchesQuery(
        [
          c.fullName,
          c.phone,
          ...c.mudirs.flatMap((m) => [m.fullName, m.branch, m.phone, ...m.staff.map((x) => x.fullName)]),
        ],
        s,
      ),
    );
  }, [data, q]);

  const withStaff = useMemo(() => {
    const list = data?.branchesWithStaff ?? [];
    const s = branchQ.trim().toLowerCase();
    if (!s) return list;
    return list.filter((b) => matchesQuery([b.branch, b.mudirName, b.coordinatorName], s));
  }, [data, branchQ]);

  const withoutStaff = useMemo(() => {
    const list = data?.branchesWithoutStaff ?? [];
    const s = branchQ.trim().toLowerCase();
    if (!s) return list;
    return list.filter((b) => matchesQuery([b.branch, b.mudirName, b.coordinatorName], s));
  }, [data, branchQ]);

  async function onExport() {
    if (!data) return;
    const section = (tab === "royxat" ? "royxat" : tab) as HolatExcelSection;
    setExporting(section);
    await new Promise((r) => window.setTimeout(r, 40));
    try {
      const coordId =
        section === "sonlar"
          ? dashCoordKey && dashCoordKey !== "all"
            ? Number(dashCoordKey)
            : data.scoped && data.coordinators[0]?.employeeId
              ? data.coordinators[0].employeeId
              : null
          : null;
      await downloadHolatExcel(
        data,
        section,
        coordId != null && Number.isFinite(coordId) ? coordId : null,
      );
      toast({
        title: "Excel yuklandi",
        description:
          section === "sonlar"
            ? coordId
              ? "Tanlangan koordinator — filiallar va xodimlar"
              : "Barcha koordinatorlar — to‘liq"
            : "Ochiq bo‘limdagi jadvallar",
      });
    } catch (e: any) {
      toast({ title: "Excel xato", description: e.message || String(e), variant: "destructive" });
    } finally {
      setExporting(null);
    }
  }

  if (!allowed) {
    return <p className="p-6 text-sm text-slate-500">Holat faqat admin, direktor, HR, koordinator va mudir uchun.</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-1">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {(error as Error)?.message || "Holat yuklanmadi"}
        <Button className="ml-3" size="sm" variant="outline" onClick={() => void refetch()}>
          Qayta
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0b3a5c] via-[#0f4a73] to-[#163a55] p-5 text-white shadow-md">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-white/15 p-2.5 ring-1 ring-white/20">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-100/90">Sozlamalar</p>
              <h1 className="text-2xl font-semibold">Holat</h1>
              <p className="mt-1 max-w-2xl text-sm text-sky-50/90">
                Tarmoq: koordinator → mudir → farmasevt/stajyor. Dashboarddan koordinatorni tanlang — filiallar ochiladi.
                {data.scoped ? " Hozir faqat sizning tarmog‘ingiz." : " To‘liq tizim."} Yangilangan: {data.generatedAt}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-slate-100 p-1 lg:w-auto lg:flex-1">
            <TabsTrigger value="sonlar" className="rounded-lg px-3 py-2">
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="qoshgan" className="rounded-lg px-3 py-2">
              Kim qo‘shgan
            </TabsTrigger>
            <TabsTrigger value="filiallar" className="rounded-lg px-3 py-2">
              Filiallar
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                {data.branchesWithoutStaff.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="tarmoq" className="rounded-lg px-3 py-2">
              Tarmoq daraxti
            </TabsTrigger>
            {!data.scoped && (
              <TabsTrigger value="royxat" className="rounded-lg px-3 py-2">
                To‘liq ro‘yxat
              </TabsTrigger>
            )}
          </TabsList>
          <Button
            type="button"
            disabled={exporting != null}
            onClick={() => void onExport()}
            className="h-11 shrink-0 gap-2 rounded-xl bg-[#0b3a5c] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#0f4a73]"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {tab === "sonlar" ? "Excel — to‘liq" : "Excel yuklab olish"}
          </Button>
        </div>

        <TabsContent value="sonlar" className="mt-0 space-y-6">
          <HolatDashboardPanel
            data={data}
            coordKey={dashCoordKey}
            onCoordKey={setDashCoordKey}
          />
        </TabsContent>

        <TabsContent value="qoshgan" className="mt-0">
          <AddedByPanel data={data} />
        </TabsContent>

        <TabsContent value="filiallar" className="mt-0">
          <FiliallarPanel
            withStaff={withStaff}
            withoutStaff={withoutStaff}
            withTotal={data.branchesWithStaff.length}
            withoutTotal={data.branchesWithoutStaff.length}
            query={branchQ}
            onQuery={setBranchQ}
            side={branchSide}
            onSide={setBranchSide}
          />
        </TabsContent>

        <TabsContent value="tarmoq" className="mt-0">
          <TarmoqPanel
            coords={filteredCoords}
            query={q}
            onQuery={setQ}
            openId={openId}
            onOpen={setOpenId}
            total={data.coordinators.length}
          />
        </TabsContent>

        {!data.scoped && (
          <TabsContent value="royxat" className="mt-0">
            <RoyxatPanel data={data} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AddedByPanel({ data }: { data: HolatReport }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-slate-800">Kim nechta odam qo‘shgan</h2>
        <p className="mt-1 text-sm text-slate-500">
          Avval tizimda kim qo‘shgani yozilgan bo‘lsa, o‘sha inson. Yozuv bo‘lmasa: mudirni koordinator, xodimni mudir
          qo‘shgan deb hisoblanadi.
        </p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pr-3">Kim</th>
              <th className="py-2.5 pr-3">Rol</th>
              <th className="py-2.5 pr-3">Mudir</th>
              <th className="py-2.5 pr-3">Farmasevt</th>
              <th className="py-2.5 pr-3">Stajyor</th>
              <th className="py-2.5">Jami</th>
            </tr>
          </thead>
          <tbody>
            {data.addedBy.map((a) => (
              <tr key={`${a.userId}-${a.fullName}`} className="border-b border-slate-100">
                <td className="py-2.5 pr-3 font-medium">{a.fullName}</td>
                <td className="py-2.5 pr-3 text-slate-600">{a.roleLabel}</td>
                <td className="py-2.5 pr-3 tabular-nums">{a.mudirs}</td>
                <td className="py-2.5 pr-3 tabular-nums">{a.pharmacists}</td>
                <td className="py-2.5 pr-3 tabular-nums">{a.interns}</td>
                <td className="py-2.5 font-semibold tabular-nums">{a.total}</td>
              </tr>
            ))}
            {!data.addedBy.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  Hali tarmoq yozuvi yo‘q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FiliallarPanel({
  withStaff,
  withoutStaff,
  withTotal,
  withoutTotal,
  query,
  onQuery,
  side,
  onSide,
}: {
  withStaff: HolatReport["branchesWithStaff"];
  withoutStaff: HolatReport["branchesWithoutStaff"];
  withTotal: number;
  withoutTotal: number;
  query: string;
  onQuery: (v: string) => void;
  side: "with" | "without";
  onSide: (v: "with" | "without") => void;
}) {
  const list = side === "with" ? withStaff : withoutStaff;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Filiallar — jamoa bor / yo‘q</h2>
          <p className="mt-1 text-sm text-slate-500">
            Har bir qator — bitta mudir filiali. «Xodimsiz» degani: mudir bor, farmasevt yoki stajyor yo‘q.
          </p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Filial, mudir, koordinator…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSide("without")}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium ring-1",
            side === "without"
              ? "bg-amber-100 text-amber-950 ring-amber-300"
              : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
          )}
        >
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          Xodim qo‘shilmagan ({withoutTotal})
        </button>
        <button
          type="button"
          onClick={() => onSide("with")}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium ring-1",
            side === "with"
              ? "bg-emerald-100 text-emerald-950 ring-emerald-300"
              : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
          )}
        >
          <Store className="mr-1 inline h-3.5 w-3.5" />
          Xodim qo‘shilgan ({withTotal})
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-2.5 pr-3">Filial</th>
              <th className="py-2.5 pr-3">Mudir</th>
              <th className="py-2.5 pr-3">Koordinator</th>
              <th className="py-2.5 pr-3">Farmasevt</th>
              <th className="py-2.5 pr-3">Stajyor</th>
              <th className="py-2.5">Holat</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.mudirEmployeeId} className="border-b border-slate-100 align-top">
                <td className="py-2.5 pr-3 font-medium">{b.branch || "Filial nomi yo‘q"}</td>
                <td className="py-2.5 pr-3">{b.mudirName}</td>
                <td className="py-2.5 pr-3">{b.coordinatorName || "—"}</td>
                <td className="py-2.5 pr-3 tabular-nums">{b.pharmacistCount}</td>
                <td className="py-2.5 pr-3 tabular-nums">{b.internCount}</td>
                <td className="py-2.5">
                  {side === "with" ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Jamoa bor
                    </span>
                  ) : (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      Jamoa yo‘q
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-slate-400">
                  {query ? "Qidiruvga mos filial yo‘q" : "Ro‘yxat bo‘sh"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Ko‘rsatilmoqda: {list.length} / {side === "with" ? withTotal : withoutTotal}
      </p>
    </section>
  );
}

function TarmoqPanel({
  coords,
  query,
  onQuery,
  openId,
  onOpen,
  total,
}: {
  coords: HolatCoordNode[];
  query: string;
  onQuery: (v: string) => void;
  openId: number | null;
  onOpen: (id: number | null) => void;
  total: number;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Koordinator → mudir → xodimlar</h2>
          <p className="mt-1 text-sm text-slate-500">
            Koordinatorni oching — uning filiallari va har bir mudir ostidagi farmasevt/stajyor chiqadi.
          </p>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            className="pl-8"
            placeholder="Ism, filial, telefon…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {coords.length} ta koordinator {query ? `(qidiruv, jami ${total})` : ""}
      </p>
      <div className="mt-4 space-y-3">
        {coords.map((c) => (
          <CoordBlock
            key={c.employeeId}
            node={c}
            open={openId === c.employeeId}
            onToggle={() => onOpen(openId === c.employeeId ? null : c.employeeId)}
          />
        ))}
        {!coords.length && <p className="py-10 text-center text-sm text-slate-400">Koordinator topilmadi</p>}
      </div>
    </section>
  );
}

function RoyxatPanel({ data }: { data: HolatReport }) {
  const [q, setQ] = useState("");
  const people = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return data.allEmployees;
    return data.allEmployees.filter((p) =>
      matchesQuery(
        [p.firstName, p.lastName, p.fullName, p.position, p.branch, p.coordinatorName, p.mudirName, p.phone],
        s,
      ),
    );
  }, [data.allEmployees, q]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="text-base font-semibold">Bo‘limlar</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase text-slate-500">
                <th className="py-2 pr-3">Bo‘lim</th>
                <th className="py-2 pr-3">Rahbar</th>
                <th className="py-2 pr-3">Xodimlar</th>
                <th className="py-2">Yaratilgan</th>
              </tr>
            </thead>
            <tbody>
              {data.departments.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-medium">{d.name}</td>
                  <td className="py-2 pr-3">{d.headName || "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{d.employeeCount}</td>
                  <td className="py-2 text-slate-500">{d.createdAt || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Barcha xodimlar</h2>
            <p className="mt-1 text-sm text-slate-500">Ism, lavozim, filial, kimga bo‘ysunadi.</p>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input className="pl-8" placeholder="Qidirish…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b text-left text-[11px] uppercase text-slate-500">
                <th className="py-2 pr-3">Ism</th>
                <th className="py-2 pr-3">Familiya</th>
                <th className="py-2 pr-3">Lavozim</th>
                <th className="py-2 pr-3">Tarmoq</th>
                <th className="py-2 pr-3">Holat</th>
                <th className="py-2 pr-3">Filial</th>
                <th className="py-2 pr-3">Koordinator</th>
                <th className="py-2 pr-3">Mudir</th>
                <th className="py-2 pr-3">Telefon</th>
                <th className="py-2">Yaratilgan</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.employeeId} className="border-b border-slate-100">
                  <td className="py-2 pr-3">{p.firstName}</td>
                  <td className="py-2 pr-3">{p.lastName || "—"}</td>
                  <td className="py-2 pr-3">{p.position}</td>
                  <td className="py-2 pr-3">{p.orgRoleLabel}</td>
                  <td className="py-2 pr-3">{p.employmentStatusLabel || "—"}</td>
                  <td className="py-2 pr-3">{p.branch}</td>
                  <td className="py-2 pr-3">{p.coordinatorName || "—"}</td>
                  <td className="py-2 pr-3">{p.mudirName || "—"}</td>
                  <td className="py-2 pr-3">{p.phone || "—"}</td>
                  <td className="py-2 text-slate-500">{p.createdAt || p.hiredAt || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          {people.length} ta qator {q ? `(jami ${data.allEmployees.length})` : ""}
        </p>
      </section>
    </div>
  );
}

function CoordBlock({
  node,
  open,
  onToggle,
}: {
  node: HolatCoordNode;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-3 text-left hover:bg-slate-100/80 sm:px-4"
      >
        <div className="min-w-0">
          <p className="font-semibold uppercase tracking-wide text-slate-900">{node.fullName}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {node.mudirCount} mudir · {node.pharmacistCount} farmasevt · {node.internCount} stajyor
            {node.phone ? (
              <span className="ml-2 inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {node.phone}
              </span>
            ) : null}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-white px-2.5 py-1 text-xs font-medium text-[#0b3a5c] ring-1 ring-slate-200">
          {open ? "Yopish" : "Ochish"}
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="space-y-3 p-3 sm:p-4">
          {!node.mudirs.length && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Bu koordinatorda hali mudir yo‘q.</p>
          )}
          {node.mudirs.map((m) => (
            <MudirBlock key={m.employeeId} mudir={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function MudirBlock({ mudir: m }: { mudir: HolatMudirNode }) {
  const empty = !m.staff.length;
  return (
    <div className={cn("rounded-lg border p-3", empty ? "border-amber-200 bg-amber-50/50" : "border-slate-100 bg-white")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-900">{m.fullName}</p>
          <p className="text-xs text-slate-500">
            {m.branch || "Filial nomi yo‘q"} · {m.pharmacistCount} farmasevt · {m.internCount} stajyor
            {m.employmentStatusLabel ? ` · ${m.employmentStatusLabel}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            Qo‘shgan: {m.createdByName || "—"}
            {m.createdAt || m.hiredAt ? ` · ${m.createdAt || m.hiredAt}` : ""}
          </p>
        </div>
        {empty ? (
          <Badge variant="secondary" className="bg-amber-100 text-amber-900">
            Xodim yo‘q
          </Badge>
        ) : null}
      </div>
      {empty ? (
        <p className="mt-2 text-sm text-amber-800">Bu filialga farmasevt yoki stajyor qo‘shilmagan.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
          {m.staff.map((s) => (
            <li key={s.employeeId} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">
                {s.firstName} {s.lastName}
              </span>
              <span className="text-slate-500">{s.orgRoleLabel}</span>
              <span className="text-slate-400">{s.phone || "raqam yo‘q"}</span>
              <span className="text-slate-400">{s.employmentStatusLabel}</span>
              <span className="text-slate-400">{s.createdAt || s.hiredAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
