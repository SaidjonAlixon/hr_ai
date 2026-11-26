/** VAKSINA Open API — hujjat matnlari (sahifa + Word/PDF) */

export type DocEndpoint = {
  path: string;
  title: string;
  scope: string | null;
  summary: string;
  params: Array<{ name: string; example: string; note: string }>;
  sampleQuery: string;
  sampleOk: string;
};

export const OPEN_API_ENDPOINTS: DocEndpoint[] = [
  {
    path: "/health",
    title: "Health (ping)",
    scope: null,
    summary: "Token yaroqlimi — tez tekshirish. Har qanday faol token bilan ishlaydi.",
    params: [],
    sampleQuery: "",
    sampleOk: `{
  "ok": true,
  "service": "vaksina-open-api",
  "version": "v1",
  "readOnly": true
}`,
  },
  {
    path: "/me",
    title: "Token meta",
    scope: null,
    summary: "Token nomi, scope ro‘yxati, muddat. Integratsiya oldidan tekshirish uchun.",
    params: [],
    sampleQuery: "",
    sampleOk: `{
  "name": "Hisobot bot",
  "prefix": "vak_a1b2…",
  "scopes": ["employees.read", "attendance.read"],
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "note": null,
  "readOnly": true
}`,
  },
  {
    path: "/employees",
    title: "Xodimlar",
    scope: "employees.read",
    summary: "Xodimlar ro‘yxati: F.I.Sh, lavozim, filial, holat. Parol chiqmaydi.",
    params: [
      { name: "limit", example: "50", note: "1–200, default 50" },
      { name: "offset", example: "0", note: "Sahifa ofseti" },
    ],
    sampleQuery: "limit=20&offset=0",
    sampleOk: `{
  "data": [{ "id": 12, "fullName": "…", "position": "Farmatsevt", "branchNo": 7 }],
  "total": 340,
  "limit": 20,
  "offset": 0
}`,
  },
  {
    path: "/attendance",
    title: "Davomat",
    scope: "attendance.read",
    summary: "Kunlik kelish–ketish yozuvlari. Sana oralig‘ini from/to bilan bering.",
    params: [
      { name: "from", example: "2026-11-01", note: "YYYY-MM-DD" },
      { name: "to", example: "2026-11-26", note: "YYYY-MM-DD" },
      { name: "limit", example: "50", note: "1–200" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "from=2026-11-01&to=2026-11-26&limit=50",
    sampleOk: `{
  "data": [{ "id": 1, "employeeId": 12, "workDate": "2026-11-26", "checkInAt": "…" }],
  "limit": 50,
  "offset": 0,
  "from": "2026-11-01",
  "to": "2026-11-26"
}`,
  },
  {
    path: "/branches",
    title: "Filiallar",
    scope: "branches.read",
    summary: "Dorixona / filial mudirlari, joylashuv (lat/lng), filial raqami.",
    params: [
      { name: "limit", example: "100", note: "max 300" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "limit=100",
    sampleOk: `{ "data": [{ "id": 5, "fullName": "Mudir …", "branchNo": 3, "location": "…" }], "limit": 100, "offset": 0 }`,
  },
  {
    path: "/departments",
    title: "Bo‘limlar",
    scope: "departments.read",
    summary: "Tashkilot bo‘limlari va boshliq ID.",
    params: [{ name: "limit", example: "100", note: "max 300" }],
    sampleQuery: "limit=100",
    sampleOk: `{ "data": [{ "id": 1, "name": "HR", "headId": 2 }] }`,
  },
  {
    path: "/payroll",
    title: "Oylik",
    scope: "payroll.read",
    summary: "Oylik hisob-kitob snapshotlari. month=YYYY-MM bilan filtr.",
    params: [
      { name: "month", example: "2026-11", note: "YYYY-MM" },
      { name: "limit", example: "50", note: "" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "month=2026-11&limit=50",
    sampleOk: `{ "data": [{ "id": 9, "userId": 3, "month": "2026-11", "totalAmount": "…" }], "month": "2026-11" }`,
  },
  {
    path: "/candidates",
    title: "Nomzodlar",
    scope: "candidates.read",
    summary: "Ishga olish pipeline’dagi nomzodlar.",
    params: [
      { name: "limit", example: "50", note: "" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 8, "fullName": "…", "stage": "interview", "status": "active" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/vacancies",
    title: "Vakansiyalar",
    scope: "vacancies.read",
    summary: "Ochiq / yopiq vakansiyalar.",
    params: [
      { name: "limit", example: "50", note: "" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 4, "title": "Farmatsevt", "status": "open" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/tasks",
    title: "Vazifalar",
    scope: "tasks.read",
    summary: "Topshiriqlar: sarlavha, status, muddat, ijrochi.",
    params: [
      { name: "limit", example: "50", note: "" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 100, "title": "…", "status": "in_progress", "dueAt": "…" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/users",
    title: "Foydalanuvchilar",
    scope: "users.read",
    summary: "Platforma akkauntlari. Parol hash / session chiqarilmaydi.",
    params: [
      { name: "limit", example: "50", note: "" },
      { name: "offset", example: "0", note: "" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 1, "fullName": "…", "role": "admin", "login": "…" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/discipline",
    title: "Intizom",
    scope: "discipline.read",
    summary: "Intizom hodisalari (oylik). month=YYYY-MM bilan filtr.",
    params: [
      { name: "month", example: "2026-11", note: "YYYY-MM" },
      { name: "limit", example: "100", note: "max 500" },
    ],
    sampleQuery: "month=2026-11&limit=100",
    sampleOk: `{ "data": [{ "id": 3, "user_id": 12, "month": "2026-11", "kind": "late" }], "month": "2026-11" }`,
  },
];

export const OPEN_API_ERRORS = [
  { code: 401, title: "Token yo‘q / noto‘g‘ri / muddati o‘tgan / bekor", when: "Authorization header yo‘q yoki token yaroqsiz" },
  { code: 403, title: "Scope yo‘q", when: "Token bu endpoint uchun ruxsat etilmagan" },
  { code: 405, title: "Faqat GET", when: "POST/PUT/PATCH/DELETE yuborilgan" },
  { code: 429, title: "Juda ko‘p so‘rov", when: "Daqiqada 120 tadan oshgan (IP+token)" },
  { code: 500, title: "Server xatosi", when: "Ichki xato — qayta urinib ko‘ring" },
  { code: 503, title: "Sxema tayyor emas", when: "Jadval hali yaratilmagan (kamdan-kam)" },
];

export function buildFullDocText(opts: {
  origin: string;
  generatedAt: string;
}) {
  const base = `${opts.origin}/api/open/v1`;
  const wall = `${opts.origin}/open-api/v1`;
  const lines: string[] = [];
  lines.push("VAKSINA HR — Open API (read-only) to‘liq qo‘llanma");
  lines.push(`Yaratilgan: ${opts.generatedAt}`);
  lines.push("");
  lines.push("1. NIMA BU?");
  lines.push(
    "Tashqi tizimlar (hisobot, BI, bot, Excel) uchun faqat o‘qish API. Ma’lumotni o‘zgartirish mumkin emas — faqat GET.",
  );
  lines.push("");
  lines.push("2. TOKENNI QAYERDAN OLISH?");
  lines.push("1) Bosh admin sifatida platformaga kiring (vaksinahr.uz).");
  lines.push("2) Chap menyudan «API Tokenlar» oching.");
  lines.push("3) Nom, muddat (yoki doimiy), kerakli scope’larni belgilang → Yaratish.");
  lines.push("4) Ekranda bir marta ko‘rsatilgan vak_… tokenni nusxa oling va xavfsiz saqlang.");
  lines.push("5) Keyin bekor qilish: «API Tokenlar» → Bekor. Jurnal: «API Devor».");
  lines.push("Muhim: plaintext token faqat yaratishda bir marta ko‘rinadi.");
  lines.push("");
  lines.push("3. QAYERGA SO‘ROV YUBORISH?");
  lines.push(`Asosiy (tavsiya, sayt orqali): ${base}`);
  lines.push(`Devor (tashqi proxy): ${wall}`);
  lines.push("Ikkalasi ham bir xil ma’lumotni beradi. Devor tashqi trafikni alohida kuzatadi.");
  lines.push("");
  lines.push("4. QANDAY ULASH?");
  lines.push("Har so‘rovda header majburiy:");
  lines.push("  Authorization: Bearer vak_XXXXXXXX");
  lines.push("Yoki: X-Api-Key: vak_XXXXXXXX");
  lines.push("");
  lines.push("curl misol:");
  lines.push(`  curl -sS -H "Authorization: Bearer vak_XXX" "${base}/health"`);
  lines.push("");
  lines.push("JavaScript (fetch) misol:");
  lines.push(`  const r = await fetch("${base}/employees?limit=20", {`);
  lines.push(`    headers: { Authorization: "Bearer vak_XXX" }`);
  lines.push("  });");
  lines.push("  const j = await r.json();");
  lines.push("");
  lines.push("Python misol:");
  lines.push("  import requests");
  lines.push(`  r = requests.get("${base}/attendance", params={"from":"2026-11-01","to":"2026-11-26"},`);
  lines.push('      headers={"Authorization":"Bearer vak_XXX"})');
  lines.push("  print(r.json())");
  lines.push("");
  lines.push("5. QOIDALAR");
  lines.push("- Faqat GET (o‘zgartirish yo‘q)");
  lines.push("- Har endpoint uchun scope kerak (/health va /me — har qanday token)");
  lines.push("- Rate limit: daqiqada ~120 so‘rov (IP + token)");
  lines.push("- Sezgir maydonlar (parol, session) javobda yo‘q");
  lines.push("");
  lines.push("6. XATO KODLARI");
  for (const e of OPEN_API_ERRORS) {
    lines.push(`HTTP ${e.code} — ${e.title}. ${e.when}`);
  }
  lines.push("");
  lines.push("7. ENDPOINTLAR");
  for (const ep of OPEN_API_ENDPOINTS) {
    lines.push("");
    lines.push(`GET ${ep.path} — ${ep.title}`);
    lines.push(`  Scope: ${ep.scope || "har qanday yaroqli token"}`);
    lines.push(`  ${ep.summary}`);
    if (ep.params.length) {
      lines.push("  Query:");
      for (const p of ep.params) {
        lines.push(`    - ${p.name}=${p.example}${p.note ? ` (${p.note})` : ""}`);
      }
    }
    lines.push(`  Misol URL: ${base}${ep.path}${ep.sampleQuery ? `?${ep.sampleQuery}` : ""}`);
    lines.push("  Misol javob:");
    for (const row of ep.sampleOk.split("\n")) lines.push(`    ${row}`);
  }
  lines.push("");
  lines.push("8. INTEGRATSIYA TARTIBI (qisqa)");
  lines.push("1. Token oling (scope’larni aniqlang).");
  lines.push("2. /health bilan tekshiring (200 bo‘lishi kerak).");
  lines.push("3. /me bilan scope’larni ko‘ring.");
  lines.push("4. Kerakli GET endpointlarga limit/offset bilan so‘rov yuboring.");
  lines.push("5. 401/403 bo‘lsa token yoki scope’ni tekshiring; 429 bo‘lsa sekinroq so‘rang.");
  lines.push("");
  lines.push("9. QAYERDAN NIMA TORTISH — TEZKOR JADVAL");
  lines.push("Xodimlar → GET /employees (employees.read)");
  lines.push("Davomat → GET /attendance?from=&to= (attendance.read)");
  lines.push("Filiallar → GET /branches (branches.read)");
  lines.push("Bo‘limlar → GET /departments (departments.read)");
  lines.push("Oylik → GET /payroll?month=YYYY-MM (payroll.read)");
  lines.push("Nomzodlar → GET /candidates (candidates.read)");
  lines.push("Vakansiyalar → GET /vacancies (vacancies.read)");
  lines.push("Vazifalar → GET /tasks (tasks.read)");
  lines.push("Foydalanuvchilar → GET /users (users.read)");
  lines.push("Intizom → GET /discipline?month=YYYY-MM (discipline.read)");
  lines.push("");
  lines.push("Yordam: platformadagi /api-docs sahifasi (sinash paneli).");
  return lines.join("\n");
}
