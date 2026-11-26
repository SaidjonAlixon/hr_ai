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
  type DocLang,
  viewEndpoint,
} from "@/lib/open-api-docs-content";
import { downloadOpenApiWordDoc } from "@/lib/open-api-docs-export";
import type { DocLangSingle } from "@/lib/open-api-docs-content";

function statusHint(code: number | null, lang: DocLang): string {
  const ru = lang === "ru";
  if (code == null) return "";
  if (code === 0) return ru ? "Сеть / CORS / DNS ошибка." : "Tarmoq uzildi yoki CORS/DNS xatosi.";
  if (code === 200) return ru ? "Успех — данные получены." : "Muvaffaqiyat — ma’lumot keldi.";
  if (code === 401)
    return ru
      ? "Нет токена / неверный / истёк / отозван."
      : "Token yo‘q, noto‘g‘ri, muddati o‘tgan yoki bekor qilingan.";
  if (code === 403)
    return ru ? "Нет scope для этого endpoint." : "Token bu endpoint uchun scope’ga ega emas.";
  if (code === 405) return ru ? "Только GET." : "Faqat GET ruxsat.";
  if (code === 429) return ru ? "Слишком много запросов." : "Juda ko‘p so‘rov.";
  if (code >= 500) return ru ? "Ошибка сервера." : "Server xatosi.";
  return "";
}

export default function ApiDocsPage() {
  const { toast } = useToast();
  const [lang, setLang] = useState<DocLang>("both");
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

  const rawEp = OPEN_API_ENDPOINTS.find((e) => e.path === selected) || OPEN_API_ENDPOINTS[0]!;
  const ep = viewEndpoint(rawEp, lang === "ru" ? "ru" : "uz");

  useEffect(() => {
    localStorage.setItem("vaksina-open-api-token", token);
  }, [token]);

  useEffect(() => {
    setQuery(rawEp.sampleQuery);
    setStatus(null);
    setResult("");
  }, [rawEp.path, rawEp.sampleQuery]);

  const browserUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (query) {
      for (const part of query.split("&")) {
        const [k, ...rest] = part.split("=");
        if (!k) continue;
        params.set(k, rest.join("=") ?? "");
      }
    }
    params.set("token", token || "vak_TOKEN");
    return `${base}${rawEp.path}?${params.toString()}`;
  }, [base, rawEp.path, query, token]);

  const plainUrl = `${base}${rawEp.path}${query ? `?${query}` : ""}`;
  const curl = `curl -sS -H "Authorization: Bearer ${token || "<TOKEN>"}" \\\n  "${plainUrl}"`;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: lang === "ru" ? "Скопировано" : "Nusxa olindi", description: label });
    } catch {
      toast({ title: lang === "ru" ? "Ошибка копирования" : "Nusxa olishda xato", variant: "destructive" });
    }
  }

  async function runTest() {
    setBusy(true);
    setResult("");
    setStatus(null);
    try {
      const url = `${base}${rawEp.path}${query ? `?${query}` : ""}`;
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
      setResult(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadWord(docLang: DocLangSingle) {
    setDlBusy(true);
    try {
      downloadOpenApiWordDoc(origin, docLang);
      toast({
        title:
          docLang === "ru"
            ? "Word скачан (RU)"
            : lang === "ru"
              ? "Word скачан (UZ)"
              : "Word yuklandi (UZ)",
        description:
          docLang === "ru"
            ? "Отдельный русский документ, таблицы выровнены."
            : lang === "ru"
              ? "Отдельный узбекский документ, таблицы выровнены."
              : "Alohida o‘zbekcha hujjat, jadvallar tekis.",
      });
    } catch (e) {
      toast({
        title: lang === "ru" ? "Ошибка" : "Xato",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setDlBusy(false);
    }
  }

  const t = (uz: string, ru: string) => (lang === "ru" ? ru : lang === "uz" ? uz : `${uz} / ${ru}`);

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-violet-50 via-white to-amber-50/40">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-violet-950 sm:text-3xl">
              <BookOpen className="h-7 w-7 text-violet-700" />
              VAKSINA Open API
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-violet-900/80">
              {t(
                "Tashqi tizimlar uchun faqat o‘qish API. Ma’lumotni o‘zgartirish mumkin emas.",
                "API только для чтения. Изменение данных невозможно.",
              )}{" "}
              <code className="rounded bg-violet-100 px-1">vak_…</code>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["uz", "ru", "both"] as const).map((l) => (
              <Button
                key={l}
                size="sm"
                variant={lang === l ? "default" : "outline"}
                className={lang === l ? "bg-violet-700" : ""}
                onClick={() => setLang(l)}
              >
                {l === "uz" ? "O‘zbek" : l === "ru" ? "Русский" : "UZ + RU"}
              </Button>
            ))}
            <Button
              className="bg-violet-700 hover:bg-violet-800"
              disabled={dlBusy}
              onClick={() => void onDownloadWord("uz")}
            >
              {dlBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Word UZ
            </Button>
            <Button
              className="bg-indigo-700 hover:bg-indigo-800"
              disabled={dlBusy}
              onClick={() => void onDownloadWord("ru")}
            >
              {dlBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
              Word RU
            </Button>
          </div>
        </div>

        <Card className="border-violet-200 bg-white/90">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4 text-violet-700" />
              {t("To‘liq hujjat — Word (UZ alohida, RU alohida)", "Полный документ — Word (UZ отдельно, RU отдельно)")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-700">
            <p>
              {t(
                "Har bir til o‘z .doc faylida. Landscape, keng maydon, bo‘limlar bo‘yicha aniq jadvallar — matn katakdan chiqib ketmaydi.",
                "Каждый язык в своём .doc. Landscape, широкие поля, аккуратные таблицы по разделам — текст не выходит за ячейки.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={dlBusy} onClick={() => void onDownloadWord("uz")}>
                <FileText className="mr-2 h-4 w-4" />
                Word O‘zbekcha (.doc)
              </Button>
              <Button size="sm" variant="secondary" disabled={dlBusy} onClick={() => void onDownloadWord("ru")}>
                <FileText className="mr-2 h-4 w-4" />
                Word Русский (.doc)
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-950">
              <Layers className="h-4 w-4" />
              <code>limit</code> / <code>offset</code>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-slate-800 lg:grid-cols-2">
            <div>
              <p className="font-semibold">UZ</p>
              <p className="mt-1">
                <code>limit</code> — bir so‘rovda nechta yozuv (default 50). <code>offset</code> — nechtasini
                o‘tkazib keyingi sahifa. Rate limit (~60–120/min) — boshqa narsa (HTTP 429).
              </p>
            </div>
            <div>
              <p className="font-semibold">RU</p>
              <p className="mt-1">
                <code>limit</code> — сколько записей за запрос (по умолчанию 50). <code>offset</code> — сколько
                пропустить. Rate limit (~60–120/мин) — другое (HTTP 429).
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListOrdered className="h-4 w-4 text-violet-600" />1. Token
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-slate-600">
              <p>
                <b>UZ:</b> Bosh admin → API Tokenlar → yaratish → bir marta nusxa.
              </p>
              <p>
                <b>RU:</b> Главный админ → API Tokenlar → создать → скопировать один раз.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-violet-600" />2. Header
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-slate-600">
              <code className="rounded bg-slate-100 px-1">Authorization: Bearer vak_…</code>
              <p className="mt-2">
                {t("Yoki brauzer havolasida ?token=", "Или в ссылке браузера ?token=")}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Link2 className="h-4 w-4 text-violet-600" />3. URL
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-start justify-between gap-2 rounded-lg bg-violet-50 px-2 py-1.5">
                <code className="break-all text-[10px]">{base}</code>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void copyText(base, "Base")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-2 py-1.5">
                <code className="break-all text-[10px]">{wallBase}</code>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void copyText(wallBase, "Wall")}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-emerald-950">
              <Shield className="h-4 w-4" />
              {t("Mustahkamlik / haker himoyasi", "Защита от взлома")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-xs text-slate-800 sm:grid-cols-2">
            <p>• {t("Faqat GET — o‘zgartirish 405", "Только GET — изменение 405")}</p>
            <p>• {t("Scope majburiy", "Scope обязателен")}</p>
            <p>• {t("login/parol/admin chiqmaydi", "login/пароль/admin не отдаются")}</p>
            <p>• {t("Bekor → hash buziladi, darhol 401", "Отзыв → hash сброшен, сразу 401")}</p>
            <p>• {t("Rate limit IP+token", "Rate limit IP+token")}</p>
            <p>• {t("Docs ochiq ≠ ma’lumot ochiq", "Открытые docs ≠ открытые данные")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("Qayerdan nima tortish?", "Откуда что брать?")}</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead>
                <tr className="border-b text-violet-900">
                  <th className="py-2 pr-3">UZ</th>
                  <th className="py-2 pr-3">RU</th>
                  <th className="py-2 pr-3">Endpoint</th>
                  <th className="py-2 pr-3">Scope</th>
                  <th className="py-2">Query</th>
                </tr>
              </thead>
              <tbody>
                {OPEN_API_ENDPOINTS.filter((e) => e.scope).map((e) => (
                  <tr key={e.path} className="border-b border-violet-50 hover:bg-violet-50/50">
                    <td className="py-2 pr-3">
                      <button type="button" className="font-medium text-violet-800 hover:underline" onClick={() => setSelected(e.path)}>
                        {e.titleUz}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-slate-700">{e.titleRu}</td>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4" />
              {t("Token va sinash", "Токен и проверка")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="vak_…"
              className="font-mono text-xs"
            />
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Endpoints</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[70vh] space-y-1 overflow-y-auto p-2">
              {OPEN_API_ENDPOINTS.map((e) => {
                const v = viewEndpoint(e, lang === "ru" ? "ru" : "uz");
                return (
                  <button
                    key={e.path}
                    type="button"
                    onClick={() => setSelected(e.path)}
                    className={`w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                      selected === e.path ? "bg-violet-600 text-white" : "hover:bg-violet-50"
                    }`}
                  >
                    <div className="font-semibold">{v.title}</div>
                    {lang === "both" ? (
                      <div className={selected === e.path ? "text-white/70" : "text-muted-foreground"}>{e.titleRu}</div>
                    ) : null}
                    <div className={selected === e.path ? "text-white/80" : "text-muted-foreground"}>GET {e.path}</div>
                  </button>
                );
              })}
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
                  <code className="text-xs">{rawEp.path}</code>
                  {rawEp.scope ? <Badge variant="outline">{rawEp.scope}</Badge> : <Badge variant="secondary">any token</Badge>}
                </div>
                <p className="text-sm text-slate-700">{ep.summary}</p>
                {lang === "both" ? <p className="text-sm text-slate-600">{rawEp.summaryRu}</p> : null}

                {rawEp.params.length > 0 ? (
                  <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                    <div className="mb-2 text-xs font-semibold text-violet-900">Query</div>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {rawEp.params.map((p) => (
                        <li key={p.name}>
                          <code className="rounded bg-white px-1">{p.name}</code> = <code>{p.example}</code>
                          <span className="text-muted-foreground">
                            {" "}
                            — {lang === "ru" ? p.noteRu : p.noteUz}
                            {lang === "both" ? ` / ${p.noteRu}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <label className="mb-1 block text-xs font-semibold">Query string</label>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="limit=20&offset=0" />
                </div>

                <div className="space-y-2 rounded-xl border-2 border-violet-300 bg-violet-50/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-bold text-violet-950">
                      {t("Brauzer havolasi", "Ссылка для браузера")}
                    </label>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" className="h-8 border-violet-300 bg-white" disabled={!token} onClick={() => void copyText(browserUrl, "URL")}>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        {t("Nusxa", "Копировать")}
                      </Button>
                      <Button size="sm" className="h-8 bg-violet-700 hover:bg-violet-800" disabled={!token} onClick={() => window.open(browserUrl, "_blank", "noopener,noreferrer")}>
                        {t("Ochish", "Открыть")}
                      </Button>
                    </div>
                  </div>
                  <pre className="overflow-x-auto break-all whitespace-pre-wrap rounded-lg bg-white p-3 text-[11px] ring-1 ring-violet-200">
                    {browserUrl}
                  </pre>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">{t("Oddiy havola", "Обычная ссылка")}</label>
                  <div className="relative">
                    <pre className="overflow-x-auto break-all whitespace-pre-wrap rounded-lg bg-slate-100 p-3 pr-12 text-[11px]">{plainUrl}</pre>
                    <Button size="sm" variant="secondary" className="absolute right-2 top-2 h-7" onClick={() => void copyText(plainUrl, "URL")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">curl</label>
                  <div className="relative">
                    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 pr-12 text-[11px] text-slate-100">{curl}</pre>
                    <Button size="sm" variant="secondary" className="absolute right-2 top-2 h-7" onClick={() => void copyText(curl.replace(/\\\n\s*/g, " "), "curl")}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <Button onClick={() => void runTest()} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {t("Sinab ko‘rish", "Проверить")}
                </Button>

                <pre className="max-h-40 overflow-auto rounded-lg bg-emerald-50/80 p-3 text-[11px] ring-1 ring-emerald-100">{rawEp.sampleOk}</pre>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {t("Natija", "Результат")}
                  {status != null && status > 0 && status < 400 ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : null}
                  {status != null && (status === 0 || status >= 400) ? <XCircle className="h-4 w-4 text-rose-600" /> : null}
                  {status != null ? <Badge variant="outline">HTTP {status || "network"}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {status != null && statusHint(status, lang) ? (
                  <p className={`text-xs ${status > 0 && status < 400 ? "text-emerald-700" : "text-rose-700"}`}>
                    {statusHint(status, lang)}
                  </p>
                ) : null}
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] ring-1 ring-slate-200">
                  {result || t("Hali so‘rov yuborilmadi.", "Запрос ещё не отправлен.")}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("HTTP kodlari", "Коды HTTP")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {OPEN_API_ERRORS.map((e) => (
              <div key={e.code} className="rounded-xl border border-slate-100 bg-white p-3">
                <Badge variant="outline" className="mb-1">
                  {e.code}
                </Badge>
                <div className="text-sm font-semibold">{lang === "ru" ? e.titleRu : e.titleUz}</div>
                <p className="mt-1 text-xs text-muted-foreground">{lang === "ru" ? e.whenRu : e.whenUz}</p>
                {lang === "both" ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    RU: {e.titleRu} — {e.whenRu}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-dashed border-violet-200 bg-violet-50/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-xs text-slate-700">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
              {t(
                "Tokenni oshkor qilmang. Bekor/o‘chirish — shu zahoti ishlamaydi.",
                "Не раскрывайте токен. Отзыв/удаление — сразу не работает.",
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={dlBusy} onClick={() => void onDownloadWord("uz")}>
                <FileText className="mr-2 h-4 w-4" />
                Word UZ
              </Button>
              <Button size="sm" variant="secondary" disabled={dlBusy} onClick={() => void onDownloadWord("ru")}>
                <FileText className="mr-2 h-4 w-4" />
                Word RU
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
