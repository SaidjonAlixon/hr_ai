import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Loader2,
  Play,
  CheckCircle2,
  XCircle,
  Download,
  FileText,
  Copy,
  KeyRound,
  Shield,
  AlertTriangle,
  Link2,
  ListOrdered,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  OPEN_API_ENDPOINTS,
  OPEN_API_ERRORS,
  type DocEndpoint,
} from "@/lib/open-api-docs-content";
import { downloadOpenApiWordDoc } from "@/lib/open-api-docs-export";

function statusHint(code: number | null): string {
  if (code == null) return "";
  if (code === 0) return "Tarmoq uzildi yoki CORS/DNS xatosi.";
  if (code === 200) return "Muvaffaqiyat — ma’lumot keldi.";
  if (code === 401) return "Token yo‘q, noto‘g‘ri, muddati o‘tgan yoki bekor qilingan.";
  if (code === 403) return "Token bu endpoint uchun scope’ga ega emas.";
  if (code === 405) return "Faqat GET ruxsat — boshqa method ishlamaydi.";
  if (code === 429) return "Juda ko‘p so‘rov — biroz kutib qayta urinib ko‘ring.";
  if (code >= 500) return "Server xatosi — keyinroq qayta urinib ko‘ring.";
  return "";
}

export default function ApiDocsPage() {
  const { toast } = useToast();
  const [token, setToken] = useState(() => localStorage.getItem("vaksina-open-api-token") || "");
  const [selected, setSelected] = useState("/health");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [result, setResult] = useState("");

  const origin = useMemo(() => window.location.origin, []);
  const base = `${origin}/api/open/v1`;
  const wallBase = `${origin}/open-api/v1`;

  const ep: DocEndpoint =
    OPEN_API_ENDPOINTS.find((e) => e.path === selected) || OPEN_API_ENDPOINTS[0]!;

  useEffect(() => {
    localStorage.setItem("vaksina-open-api-token", token);
  }, [token]);

  useEffect(() => {
    setQuery(ep.sampleQuery);
    setStatus(null);
    setResult("");
  }, [ep.path, ep.sampleQuery]);

  const curl = `curl -sS -H "Authorization: Bearer ${token || "<TOKEN>"}" \\\n  "${base}${ep.path}${query ? `?${query}` : ""}"`;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Nusxa olindi", description: label });
    } catch {
      toast({ title: "Nusxa olishda xato", variant: "destructive" });
    }
  }

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

  async function onDownloadWord() {
    setDlBusy(true);
    try {
      downloadOpenApiWordDoc(origin);
      toast({
        title: "Word yuklandi",
        description: "To‘liq qo‘llanma: token, limit/offset, URL, endpointlar, xatolar.",
      });
    } catch (e) {
      toast({
        title: "Yuklab olishda xato",
        description: e instanceof Error ? e.message : "Qayta urinib ko‘ring",
        variant: "destructive",
      });
    } finally {
      setDlBusy(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-violet-50 via-white to-amber-50/40">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        {/* Hero */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-violet-950 sm:text-3xl">
              <BookOpen className="h-7 w-7 text-violet-700" />
              VAKSINA Open API
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-violet-900/75">
              Tashqi tizimlar uchun <strong>faqat o‘qish</strong> API. Ma’lumotni o‘zgartirish mumkin emas.
              Ishlatish uchun bosh admin bergan <code className="rounded bg-violet-100 px-1">vak_…</code> token kerak.
            </p>
          </div>
          <Button
            className="bg-violet-700 hover:bg-violet-800"
            disabled={dlBusy}
            onClick={() => void onDownloadWord()}
          >
            {dlBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Word qo‘llanma (.doc)
          </Button>
        </div>

        <Card className="border-violet-200/80 bg-white/90 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-violet-700" />
              To‘liq hujjat — Word
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>
              <strong>Word (.doc)</strong> da: tokenni qayerdan olish, <strong>limit/offset nima</strong>,
              qayerga so‘rov yuborish, qaysi endpointdan nima tortish, curl/JS/Python misollar, xato kodlari —
              hammasi bir faylda.
            </p>
            <p className="text-xs text-muted-foreground">
              Fayl: <code>VAKSINA_Open_API_qollanma_….doc</code> — brauzer «Yuklamalar» papkasiga tushadi.
            </p>
          </CardContent>
        </Card>

        <Card className="border-amber-200/80 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950">
              <Layers className="h-4 w-4" />
              <code className="rounded bg-white px-1.5 py-0.5 text-sm">limit</code> va{" "}
              <code className="rounded bg-white px-1.5 py-0.5 text-sm">offset</code> nima?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-slate-800">
            <div>
              <p className="font-semibold text-amber-950">limit — bir so‘rovda nechta qator</p>
              <p className="mt-1 text-slate-700">
                Server sizga hamma bazani birdan bermaydi. <code>limit</code> — «shu so‘rovda eng ko‘pi bilan
                shuncha yozuv qaytar». Masalan <code>?limit=20</code> → javobda 20 ta (yoki undan kam, agar
                shuncha qolmagan bo‘lsa). Default odatda <strong>50</strong>. Har endpointda maksimum bor
                (xodimlar 200, filiallar 300, intizom 500).
              </p>
            </div>
            <div>
              <p className="font-semibold text-amber-950">offset — nechtasini o‘tkazib yuborish (sahifa)</p>
              <p className="mt-1 text-slate-700">
                Katta ro‘yxatni sahifa-sahifa olasiz. <code>offset</code> — boshidan nechta yozuvni
                tashlab, keyingilarini olish.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-700">
                <li>
                  <code>limit=20&amp;offset=0</code> → 1–20-qator (1-sahifa)
                </li>
                <li>
                  <code>limit=20&amp;offset=20</code> → 21–40-qator (2-sahifa)
                </li>
                <li>
                  <code>limit=20&amp;offset=40</code> → 41–60-qator (3-sahifa)
                </li>
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-white/80 p-3 text-xs text-slate-700">
              <p className="font-semibold text-amber-950">Ikki xil «limit» aralashmasin</p>
              <p className="mt-1">
                Query’dagi <code>limit</code> — nechta yozuv.{" "}
                <strong>Rate limit</strong> esa boshqa narsa: daqiqada ~120 ta so‘rovdan oshmasin (aks holda
                HTTP 429).
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="border-violet-100">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListOrdered className="h-4 w-4 text-violet-600" />
                1. Token oling
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs leading-relaxed text-slate-600">
              <p>
                Bosh admin → platforma → <strong>API Tokenlar</strong>.
              </p>
              <p>Nom + scope’lar + muddat → Yaratish → <code>vak_…</code> ni bir marta nusxa oling.</p>
              <p className="text-amber-800">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Keyin qayta ko‘rsatilmaydi.
              </p>
            </CardContent>
          </Card>
          <Card className="border-violet-100">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-violet-600" />
                2. Header qo‘ying
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs leading-relaxed text-slate-600">
              <p>
                Har so‘rovda:{" "}
                <code className="rounded bg-slate-100 px-1">Authorization: Bearer vak_…</code>
              </p>
              <p>Pastdagi maydonga tokenni yozib, «Sinab ko‘rish» bilan tekshirishingiz mumkin.</p>
            </CardContent>
          </Card>
          <Card className="border-violet-100">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4 text-violet-600" />
                3. Qayerga yuborish
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs leading-relaxed text-slate-600">
              <div className="flex items-start justify-between gap-2 rounded-lg bg-violet-50 px-2 py-1.5">
                <div>
                  <div className="font-semibold text-violet-900">Asosiy</div>
                  <code className="break-all text-[10px]">{base}</code>
                </div>
                <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => void copyText(base, "Base URL")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-2 py-1.5">
                <div>
                  <div className="font-semibold text-amber-900">Devor (proxy)</div>
                  <code className="break-all text-[10px]">{wallBase}</code>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2"
                  onClick={() => void copyText(wallBase, "Devor URL")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick map */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Qayerdan nima tortish?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b text-violet-900">
                    <th className="py-2 pr-3 font-semibold">Ma’lumot</th>
                    <th className="py-2 pr-3 font-semibold">Endpoint</th>
                    <th className="py-2 pr-3 font-semibold">Scope</th>
                    <th className="py-2 font-semibold">Asosiy parametr</th>
                  </tr>
                </thead>
                <tbody>
                  {OPEN_API_ENDPOINTS.filter((e) => e.scope).map((e) => (
                    <tr key={e.path} className="border-b border-violet-50 hover:bg-violet-50/50">
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="font-medium text-violet-800 underline-offset-2 hover:underline"
                          onClick={() => setSelected(e.path)}
                        >
                          {e.title}
                        </button>
                      </td>
                      <td className="py-2 pr-3 font-mono">GET {e.path}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {e.scope}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">{e.sampleQuery || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Token + try */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              Token va sinash paneli
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="vak_… tokenni shu yerga qo‘ying"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              Tokensiz so‘rov → HTTP 401. Token brauzerda faqat shu qurilmada saqlanadi (localStorage).
            </p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Endpointlar</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
              {OPEN_API_ENDPOINTS.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => setSelected(e.path)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    selected === e.path ? "bg-violet-600 text-white" : "hover:bg-violet-50"
                  }`}
                >
                  <div className="font-semibold">{e.title}</div>
                  <div className={selected === e.path ? "text-white/80" : "text-muted-foreground"}>
                    GET {e.path}
                  </div>
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
                  {ep.scope ? (
                    <Badge variant="outline">{ep.scope}</Badge>
                  ) : (
                    <Badge variant="secondary">har qanday token</Badge>
                  )}
                </div>
                <p className="text-sm text-slate-700">{ep.summary}</p>

                {ep.params.length > 0 ? (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                    <div className="mb-2 text-xs font-semibold text-violet-900">Query parametrlari</div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {ep.params.map((p) => (
                        <li key={p.name}>
                          <code className="rounded bg-white px-1">{p.name}</code> ={" "}
                          <code>{p.example}</code>
                          {p.note ? <span className="text-muted-foreground"> — {p.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Query parametrlari shart emas.</p>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold">Query string (sinash)</label>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="limit=20&offset=0" />
                </div>

                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 pr-12 text-[11px] text-slate-100">
                    {curl}
                  </pre>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute right-2 top-2 h-7"
                    onClick={() => void copyText(curl.replace(/\\\n\s*/g, " "), "curl")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runTest()} disabled={busy}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    Sinab ko‘rish
                  </Button>
                  {!token ? (
                    <span className="self-center text-xs text-amber-700">
                      Avval token kiriting — aks holda 401 chiqadi.
                    </span>
                  ) : null}
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Misol 200 javob</div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-emerald-50/80 p-3 text-[11px] text-emerald-950 ring-1 ring-emerald-100">
                    {ep.sampleOk}
                  </pre>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
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
              <CardContent className="space-y-2">
                {status != null && statusHint(status) ? (
                  <p
                    className={`text-xs ${
                      status > 0 && status < 400 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {statusHint(status)}
                  </p>
                ) : null}
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] ring-1 ring-slate-200">
                  {result || "Hali so‘rov yuborilmadi. Token qo‘yib «Sinab ko‘rish»ni bosing."}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Errors */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Barcha holatlar — HTTP kodlari</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {OPEN_API_ERRORS.map((e) => (
              <div key={e.code} className="rounded-xl border border-slate-100 bg-white p-3">
                <div className="flex items-center gap-2">
                  <Badge variant={e.code === 401 || e.code === 403 ? "destructive" : "outline"}>
                    {e.code}
                  </Badge>
                  <span className="text-sm font-semibold">{e.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{e.when}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-dashed border-violet-200 bg-violet-50/30">
          <CardContent className="space-y-2 pt-5 text-sm text-slate-700">
            <p className="font-semibold text-violet-950">Integratsiya tartibi</p>
            <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed">
              <li>Bosh admindan kerakli scope’li token oling.</li>
              <li>
                <code>/health</code> bilan 200 tekshiring.
              </li>
              <li>
                <code>/me</code> orqali scope va muddatni ko‘ring.
              </li>
              <li>
                Yuqoridagi jadvaldan kerakli GET ni tanlang; katta ro‘yxatni{" "}
                <code>limit</code>/<code>offset</code> bilan sahifa-sahifa oling.
              </li>
              <li>
                Jurnal uchun admin <strong>API Devor</strong> sahifasini ochadi; tashqi trafik uchun{" "}
                <code>/open-api/v1</code> ham ishlaydi.
              </li>
            </ol>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button disabled={dlBusy} onClick={() => void onDownloadWord()}>
                {dlBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Word qo‘llanma
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
