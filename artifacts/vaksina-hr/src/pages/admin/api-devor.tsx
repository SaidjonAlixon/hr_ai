import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Shield,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Activity,
  Globe2,
  Timer,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BookOpen,
} from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { isBoshAdmin } from "@/lib/roles";
import {
  fetchApiTokenLogs,
  fetchApiTokens,
  type ApiAccessLog,
} from "@/lib/api-tokens-api";

function fmt(s?: string | null) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("uz-UZ", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return s;
  }
}

function statusLabel(code: number): string {
  if (code >= 200 && code < 300) return "Muvaffaqiyat — ma’lumot berildi";
  if (code === 401) return "Token yo‘q / noto‘g‘ri / muddati o‘tgan / bekor";
  if (code === 403) return "Scope yo‘q — bu token uchun ruxsat yo‘q";
  if (code === 405) return "Faqat GET ruxsat (o‘zgartirish yo‘q)";
  if (code === 429) return "Juda ko‘p so‘rov (rate limit)";
  if (code >= 400 && code < 500) return "Mijoz xatosi";
  if (code >= 500) return "Server xatosi";
  return "Noma’lum holat";
}

function statusTone(code: number): string {
  if (code >= 500) return "border-rose-300 bg-rose-50 text-rose-800";
  if (code >= 400) return "border-amber-300 bg-amber-50 text-amber-900";
  if (code >= 200 && code < 300) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function shortUa(ua?: string | null): string {
  if (!ua) return "—";
  const s = ua.trim();
  if (/hr-api-wall/i.test(s) || /api-wall/i.test(s)) return "API Devor (proxy)";
  if (/curl/i.test(s)) return "curl";
  if (/python|requests/i.test(s)) return "Python";
  if (/postman/i.test(s)) return "Postman";
  if (/chrome/i.test(s)) return "Chrome brauzer";
  if (/firefox/i.test(s)) return "Firefox";
  if (/safari/i.test(s) && !/chrome/i.test(s)) return "Safari";
  if (/edg/i.test(s)) return "Edge";
  if (s.length > 48) return `${s.slice(0, 48)}…`;
  return s;
}

function endpointTitle(path: string): string {
  const p = path.replace(/\?.*$/, "").replace(/\/+$/, "");
  const map: Record<string, string> = {
    "/api/open/v1/health": "Health (ping)",
    "/api/open/v1/me": "Token meta",
    "/api/open/v1/employees": "Xodimlar",
    "/api/open/v1/attendance": "Davomat",
    "/api/open/v1/branches": "Filiallar",
    "/api/open/v1/departments": "Bo‘limlar",
    "/api/open/v1/payroll": "Oylik",
    "/api/open/v1/candidates": "Nomzodlar",
    "/api/open/v1/vacancies": "Vakansiyalar",
    "/api/open/v1/tasks": "Vazifalar",
    "/api/open/v1/users": "Foydalanuvchilar",
    "/api/open/v1/discipline": "Intizom",
    "/api/open/v1/openapi.json": "OpenAPI katalog",
  };
  return map[p] || p.split("/").filter(Boolean).slice(-1)[0] || path;
}

function LogRow({ log }: { log: ApiAccessLog }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className={`border-b border-border/50 align-top transition hover:bg-violet-50/40 ${
          open ? "bg-violet-50/60" : ""
        }`}
      >
        <td className="px-3 py-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-violet-700"
            onClick={() => setOpen((v) => !v)}
            aria-label="Batafsil"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <div className="font-medium text-slate-900">{fmt(log.createdAt)}</div>
          <div className="text-[10px] text-muted-foreground">ID #{log.id}</div>
        </td>
        <td className="px-3 py-3">
          <div className="font-semibold text-slate-900">{log.tokenName || `Token #${log.tokenId}`}</div>
          <code className="text-[11px] text-violet-700">{log.tokenPrefix || "vak_…"}…</code>
          <div className="text-[10px] text-muted-foreground">token_id={log.tokenId}</div>
        </td>
        <td className="px-3 py-3">
          <div className="font-medium text-slate-900">{endpointTitle(log.path)}</div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-700">
            <Badge variant="secondary" className="mr-1 font-mono text-[10px]">
              {log.method}
            </Badge>
            {log.path}
          </div>
          {log.querySummary ? (
            <div className="mt-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              ?{log.querySummary}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-muted-foreground">Query yo‘q</div>
          )}
        </td>
        <td className="px-3 py-3">
          <Badge variant="outline" className={statusTone(log.status)}>
            HTTP {log.status}
          </Badge>
          <div className="mt-1 max-w-[180px] text-[10px] leading-snug text-muted-foreground">
            {statusLabel(log.status)}
          </div>
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1 font-medium">
            <Globe2 className="h-3.5 w-3.5 text-slate-400" />
            {log.ip || "—"}
          </div>
          <div className="mt-1 text-[11px] text-slate-600">
            {log.deviceLabel ? (
              <span className="font-medium text-violet-800">{log.deviceLabel}</span>
            ) : (
              shortUa(log.userAgent)
            )}
          </div>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <Timer className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-semibold">{log.durationMs ?? "—"}</span>
            <span className="text-muted-foreground">ms</span>
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-violet-100 bg-violet-50/40">
          <td colSpan={7} className="px-4 py-4">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-violet-100 bg-white p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-900">
                  So‘rov tafsiloti
                </div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Vaqt</dt>
                    <dd className="font-medium">{fmt(log.createdAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Method</dt>
                    <dd className="font-mono">{log.method}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">To‘liq path</dt>
                    <dd className="break-all font-mono">{log.path}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Query</dt>
                    <dd className="break-all font-mono">{log.querySummary || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Endpoint</dt>
                    <dd>{endpointTitle(log.path)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Status</dt>
                    <dd>
                      {log.status} — {statusLabel(log.status)}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Davomiylik</dt>
                    <dd>{log.durationMs != null ? `${log.durationMs} ms` : "—"}</dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-xl border border-violet-100 bg-white p-3">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-violet-900">
                  Kim / qayerdan
                </div>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Token nomi</dt>
                    <dd className="font-medium">{log.tokenName || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Prefix</dt>
                    <dd className="font-mono">{log.tokenPrefix || "—"}…</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Token ID</dt>
                    <dd>{log.tokenId}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">IP manzil</dt>
                    <dd className="font-mono">{log.ip || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Qurilma yorlig‘i</dt>
                    <dd>{log.deviceLabel || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">User-Agent</dt>
                    <dd className="break-all text-[11px] leading-relaxed text-slate-700">
                      {log.userAgent || "—"}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Qisqa UA</dt>
                    <dd>{shortUa(log.userAgent)}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export default function AdminApiDevorPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const allowed = isBoshAdmin(user);
  const [tokenId, setTokenId] = useState("");
  const [path, setPath] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "client" | "server">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const tokensQ = useQuery({
    queryKey: ["api-tokens", "list"],
    queryFn: fetchApiTokens,
    enabled: allowed,
  });

  const logsQ = useQuery({
    queryKey: ["api-tokens", "logs", tokenId, path, from, to],
    queryFn: () =>
      fetchApiTokenLogs({
        tokenId: tokenId ? Number(tokenId) : undefined,
        path: path || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: 300,
      }),
    enabled: allowed,
    refetchInterval: 5_000,
  });

  const logs = logsQ.data?.logs || [];

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (statusFilter === "ok") return l.status >= 200 && l.status < 300;
      if (statusFilter === "client") return l.status >= 400 && l.status < 500;
      if (statusFilter === "server") return l.status >= 500;
      return true;
    });
  }, [logs, statusFilter]);

  const stats = useMemo(() => {
    const ok = logs.filter((l) => l.status >= 200 && l.status < 300).length;
    const client = logs.filter((l) => l.status >= 400 && l.status < 500).length;
    const server = logs.filter((l) => l.status >= 500).length;
    const ips = new Set(logs.map((l) => l.ip).filter(Boolean));
    const tokens = new Set(logs.map((l) => l.tokenId));
    const withMs = logs.filter((l) => l.durationMs != null) as Array<ApiAccessLog & { durationMs: number }>;
    const avgMs =
      withMs.length > 0
        ? Math.round(withMs.reduce((s, l) => s + (l.durationMs || 0), 0) / withMs.length)
        : null;
    const byPath = new Map<string, number>();
    for (const l of logs) {
      const key = l.path.replace(/\?.*$/, "");
      byPath.set(key, (byPath.get(key) || 0) + 1);
    }
    const topPaths = [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { ok, client, server, ips: ips.size, tokens: tokens.size, avgMs, topPaths, total: logs.length };
  }, [logs]);

  if (!allowed) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Faqat bosh admin API Devorni ko‘ra oladi.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-3 pb-20 sm:p-5 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-950 via-violet-900 to-indigo-900 px-5 py-5 text-white shadow-md">
        <div className="max-w-3xl">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Shield className="h-6 w-6 text-violet-200" />
            API Devor
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-violet-100/90">
            Open API ga kelgan har bir so‘rov shu yerda ko‘rinadi: qaysi token, qaysi endpoint, IP,
            brauzer/qurilma, status va javob vaqti. Har 5 soniyada avtomatik yangilanadi. Qatorni
            ochib to‘liq User-Agent va query ni ko‘ring.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm" className="bg-white/15 text-white hover:bg-white/25">
            <Link href="/admin/api-tokens">Tokenlar</Link>
          </Button>
          <Button asChild variant="secondary" size="sm" className="bg-white/15 text-white hover:bg-white/25">
            <Link href="/api-docs">
              <BookOpen className="mr-1.5 h-3.5 w-3.5" />
              Docs
            </Link>
          </Button>
          <Button
            size="sm"
            className="bg-white text-violet-900 hover:bg-violet-50"
            onClick={() => void qc.invalidateQueries({ queryKey: ["api-tokens", "logs"] })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Yangilash
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card className="border-violet-100">
          <CardContent className="flex items-center gap-3 pt-5">
            <Activity className="h-8 w-8 text-violet-600" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Jami (filtr)</div>
              <div className="text-2xl font-bold">{stats.total}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-100">
          <CardContent className="flex items-center gap-3 pt-5">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Muvaffaqiyat 2xx</div>
              <div className="text-2xl font-bold text-emerald-700">{stats.ok}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-100">
          <CardContent className="flex items-center gap-3 pt-5">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Mijoz xato 4xx</div>
              <div className="text-2xl font-bold text-amber-700">{stats.client}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-rose-100">
          <CardContent className="flex items-center gap-3 pt-5">
            <XCircle className="h-8 w-8 text-rose-600" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Server 5xx</div>
              <div className="text-2xl font-bold text-rose-700">{stats.server}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-5">
            <Globe2 className="h-8 w-8 text-slate-500" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Noyob IP</div>
              <div className="text-2xl font-bold">{stats.ips}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-5">
            <Timer className="h-8 w-8 text-slate-500" />
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">O‘rtacha ms</div>
              <div className="text-2xl font-bold">{stats.avgMs ?? "—"}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Filtrlar</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold">Token</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={tokenId}
                onChange={(e) => setTokenId(e.target.value)}
              >
                <option value="">Barcha tokenlar</option>
                {(tokensQ.data?.tokens || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.tokenPrefix}…) {t.active ? "" : "— bekor"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Path qidiruv</label>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/employees yoki /health"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Dan (sana/vaqt)</label>
              <Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Gacha</label>
              <Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="mb-1 block text-xs font-semibold">Status guruhi</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "Hammasi"],
                    ["ok", "Faqat 2xx"],
                    ["client", "Faqat 4xx"],
                    ["server", "Faqat 5xx"],
                  ] as const
                ).map(([k, label]) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={statusFilter === k ? "default" : "outline"}
                    onClick={() => setStatusFilter(k)}
                  >
                    {label}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setTokenId("");
                    setPath("");
                    setFrom("");
                    setTo("");
                    setStatusFilter("all");
                  }}
                >
                  Tozalash
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Eng ko‘p so‘ralgan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.topPaths.length === 0 ? (
              <p className="text-xs text-muted-foreground">Hali ma’lumot yo‘q</p>
            ) : (
              stats.topPaths.map(([p, n]) => (
                <button
                  key={p}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg border border-violet-50 bg-violet-50/40 px-2.5 py-2 text-left text-xs hover:bg-violet-100/60"
                  onClick={() => setPath(p.replace("/api/open/v1", "") || p)}
                >
                  <span>
                    <div className="font-medium">{endpointTitle(p)}</div>
                    <code className="text-[10px] text-muted-foreground">{p}</code>
                  </span>
                  <Badge variant="secondary">{n}</Badge>
                </button>
              ))
            )}
            <p className="pt-1 text-[10px] text-muted-foreground">
              Faol tokenlar (jurnalda): {stats.tokens}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            So‘rovlar jurnali
            <Badge variant="outline" className="font-normal">
              har 5 soniyada
            </Badge>
            <Badge variant="secondary" className="font-normal">
              ko‘rsatilmoqda: {filtered.length}
            </Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Chapdagi ▶ tugmasini bosib qatorni kengaytiring — to‘liq path, query, IP, User-Agent.
          </p>
        </CardHeader>
        <CardContent>
          {logsQ.isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Hali so‘rov yo‘q yoki filtr bo‘yicha topilmadi.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-violet-100">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-violet-950 text-[11px] uppercase tracking-wide text-violet-100">
                  <tr>
                    <th className="w-10 px-3 py-3" />
                    <th className="px-3 py-3">Vaqt</th>
                    <th className="px-3 py-3">Token</th>
                    <th className="px-3 py-3">Endpoint / Path / Query</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">IP / Qurilma</th>
                    <th className="px-3 py-3">Davomiylik</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {filtered.map((l) => (
                    <LogRow key={l.id} log={l} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-dashed border-violet-200 bg-violet-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Statuslar qisqa izohi</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-xs text-slate-700">
          <div className="rounded-lg bg-white p-3 ring-1 ring-emerald-100">
            <Badge className="mb-1 border-emerald-300 bg-emerald-50 text-emerald-800" variant="outline">
              200
            </Badge>
            So‘rov muvaffaqiyatli, ma’lumot qaytdi.
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-amber-100">
            <Badge className="mb-1 border-amber-300 bg-amber-50 text-amber-900" variant="outline">
              401
            </Badge>
            Token yo‘q, noto‘g‘ri, muddati o‘tgan yoki bekor.
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-amber-100">
            <Badge className="mb-1 border-amber-300 bg-amber-50 text-amber-900" variant="outline">
              403
            </Badge>
            Token bor, lekin bu endpoint uchun scope yo‘q.
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-amber-100">
            <Badge className="mb-1 border-amber-300 bg-amber-50 text-amber-900" variant="outline">
              429
            </Badge>
            Juda ko‘p so‘rov — daqiqada 120 dan oshgan.
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-rose-100">
            <Badge className="mb-1 border-rose-300 bg-rose-50 text-rose-800" variant="outline">
              5xx
            </Badge>
            Server tomonda xato — tekshirish kerak.
          </div>
          <div className="rounded-lg bg-white p-3 ring-1 ring-violet-100">
            <strong className="text-violet-900">Eslatma:</strong> login/parol/admin ma’lumoti API
            javobida ham, shu jurnalda ham chiqmaydi.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
