import { useEffect, useMemo, useState } from "react";
import { BookOpen, Loader2, Play, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Scope = { id: string; label: string; description: string; path: string };

type OpenApiDoc = {
  info?: { title?: string; version?: string; description?: string };
  "x-scopes"?: Scope[];
  paths?: Record<string, unknown>;
};

const ENDPOINTS: Array<{ path: string; scope: string | null; title: string; hint: string }> = [
  { path: "/health", scope: null, title: "Health", hint: "Token ishlayotganini tekshirish" },
  { path: "/me", scope: null, title: "Token meta", hint: "Nom, scope, muddat" },
  { path: "/employees", scope: "employees.read", title: "Xodimlar", hint: "?limit=&offset=" },
  { path: "/attendance", scope: "attendance.read", title: "Davomat", hint: "?from=YYYY-MM-DD&to=YYYY-MM-DD" },
  { path: "/branches", scope: "branches.read", title: "Filiallar", hint: "Mudir filiallari" },
  { path: "/departments", scope: "departments.read", title: "Bo‘limlar", hint: "" },
  { path: "/payroll", scope: "payroll.read", title: "Oylik", hint: "?month=YYYY-MM" },
  { path: "/candidates", scope: "candidates.read", title: "Nomzodlar", hint: "" },
  { path: "/vacancies", scope: "vacancies.read", title: "Vakansiyalar", hint: "" },
  { path: "/tasks", scope: "tasks.read", title: "Vazifalar", hint: "" },
  { path: "/users", scope: "users.read", title: "Foydalanuvchilar", hint: "Parolsiz" },
  { path: "/discipline", scope: "discipline.read", title: "Intizom", hint: "?month=YYYY-MM" },
];

export default function ApiDocsPage() {
  const [token, setToken] = useState(() => localStorage.getItem("vaksina-open-api-token") || "");
  const [selected, setSelected] = useState("/health");
  const [query, setQuery] = useState("limit=20");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [result, setResult] = useState<string>("");
  const [doc, setDoc] = useState<OpenApiDoc | null>(null);

  useEffect(() => {
    void fetch("/api/open/v1/openapi.json")
      .then((r) => r.json())
      .then((j) => setDoc(j as OpenApiDoc))
      .catch(() => setDoc(null));
  }, []);

  useEffect(() => {
    localStorage.setItem("vaksina-open-api-token", token);
  }, [token]);

  const base = useMemo(() => `${window.location.origin}/api/open/v1`, []);
  const ep = ENDPOINTS.find((e) => e.path === selected) || ENDPOINTS[0];

  const curl = `curl -sS -H "Authorization: Bearer ${token || "<TOKEN>"}" \\\n  "${base}${ep.path}${query ? `?${query}` : ""}"`;

  async function runTest() {
    setBusy(true);
    setResult("");
    setStatus(null);
    try {
      const url = `${base}${ep.path}${query ? `?${query}` : ""}`;
      const res = await fetch(url, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      setStatus(res.status);
      const text = await res.text();
      try {
        setResult(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResult(text);
      }
    } catch (e) {
      setStatus(0);
      setResult(e instanceof Error ? e.message : "Tarmoq xatosi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-violet-50 to-white">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-violet-950">
            <BookOpen className="h-6 w-6" />
            VAKSINA Open API
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-violet-900/70">
            Read-only API. Tokensiz ishlamaydi. Tokenni bosh admin «API Tokenlar» bo‘limidan beradi. Faqat GET —
            ma’lumotni o‘zgartirish mumkin emas.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Base URL: <code className="rounded bg-violet-100 px-1.5 py-0.5">{base}</code>
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1) Token</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="vak_… tokenni shu yerga qo‘ying"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Header: <code>Authorization: Bearer &lt;token&gt;</code>
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Endpointlar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-2">
              {ENDPOINTS.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => setSelected(e.path)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    selected === e.path ? "bg-violet-600 text-white" : "hover:bg-violet-50"
                  }`}
                >
                  <div className="font-semibold">{e.title}</div>
                  <div className={selected === e.path ? "text-white/80" : "text-muted-foreground"}>GET {e.path}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ep.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge>GET</Badge>
                  <code className="text-xs">{ep.path}</code>
                  {ep.scope ? <Badge variant="outline">{ep.scope}</Badge> : <Badge variant="secondary">har qanday token</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{ep.hint || "Parametrlar ixtiyoriy."}</p>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Query string</label>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="limit=20&offset=0" />
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{curl}</pre>
                <Button onClick={() => void runTest()} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Sinab ko‘rish
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  Natija
                  {status != null && status > 0 && status < 400 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : null}
                  {status != null && (status === 0 || status >= 400) ? (
                    <XCircle className="h-4 w-4 text-rose-600" />
                  ) : null}
                  {status != null ? <Badge variant="outline">HTTP {status || "network"}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] ring-1 ring-slate-200">
                  {result || "Hali so‘rov yuborilmadi."}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Scope katalogi</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {(doc?.["x-scopes"] || ENDPOINTS.filter((e) => e.scope).map((e) => ({
              id: e.scope!,
              label: e.title,
              description: e.hint,
              path: e.path,
            }))).map((s) => (
              <div key={s.id} className="rounded-xl border border-violet-100 bg-white p-3">
                <div className="font-semibold text-sm">{s.label}</div>
                <div className="text-[11px] text-muted-foreground">{s.description}</div>
                <code className="mt-1 block text-[10px] text-violet-700">
                  {s.id} · GET {s.path}
                </code>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
