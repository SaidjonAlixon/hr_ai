/** VAKSINA Open API — hujjat matnlari UZ + RU (sahifa + Word) */

export type DocLang = "uz" | "ru" | "both";

export type DocEndpoint = {
  path: string;
  titleUz: string;
  titleRu: string;
  scope: string | null;
  summaryUz: string;
  summaryRu: string;
  params: Array<{ name: string; example: string; noteUz: string; noteRu: string }>;
  sampleQuery: string;
  sampleOk: string;
};

export const OPEN_API_ENDPOINTS: DocEndpoint[] = [
  {
    path: "/health",
    titleUz: "Health (ping)",
    titleRu: "Health (пинг)",
    scope: null,
    summaryUz: "Token yaroqlimi — tez tekshirish. Har qanday faol token bilan ishlaydi.",
    summaryRu: "Проверка токена. Работает с любым активным токеном.",
    params: [],
    sampleQuery: "",
    sampleOk: `{\n  "ok": true,\n  "service": "vaksina-open-api",\n  "version": "v1",\n  "readOnly": true\n}`,
  },
  {
    path: "/me",
    titleUz: "Token meta",
    titleRu: "Мета токена",
    scope: null,
    summaryUz: "Token nomi, scope ro‘yxati, muddat.",
    summaryRu: "Имя токена, список scopes, срок действия.",
    params: [],
    sampleQuery: "",
    sampleOk: `{\n  "name": "Hisobot bot",\n  "prefix": "vak_a1b2…",\n  "scopes": ["employees.read"],\n  "expiresAt": null,\n  "readOnly": true\n}`,
  },
  {
    path: "/employees",
    titleUz: "Xodimlar",
    titleRu: "Сотрудники",
    scope: "employees.read",
    summaryUz: "Xodimlar: F.I.Sh, lavozim, filial, holat. Login/parol/admin chiqmaydi.",
    summaryRu: "Сотрудники: Ф.И.О, должность, филиал, статус. Логин/пароль/admin не отдаются.",
    params: [
      {
        name: "limit",
        example: "50",
        noteUz: "Bir so‘rovda nechta qator (1–200, default 50)",
        noteRu: "Сколько строк за запрос (1–200, по умолчанию 50)",
      },
      {
        name: "offset",
        example: "0",
        noteUz: "Nechtasini o‘tkazib yuborish (sahifa)",
        noteRu: "Сколько строк пропустить (пагинация)",
      },
    ],
    sampleQuery: "limit=20&offset=0",
    sampleOk: `{\n  "data": [{ "id": 12, "fullName": "…", "position": "Farmatsevt", "branchNo": 7 }],\n  "total": 340,\n  "limit": 20,\n  "offset": 0\n}`,
  },
  {
    path: "/attendance",
    titleUz: "Davomat",
    titleRu: "Посещаемость",
    scope: "attendance.read",
    summaryUz: "Kunlik kelish–ketish. from/to bilan filtr.",
    summaryRu: "Ежедневные приходы/уходы. Фильтр from/to.",
    params: [
      { name: "from", example: "2026-11-01", noteUz: "YYYY-MM-DD", noteRu: "YYYY-MM-DD" },
      { name: "to", example: "2026-11-26", noteUz: "YYYY-MM-DD", noteRu: "YYYY-MM-DD" },
      { name: "limit", example: "50", noteUz: "1–200", noteRu: "1–200" },
      { name: "offset", example: "0", noteUz: "Sahifa", noteRu: "Пагинация" },
    ],
    sampleQuery: "from=2026-11-01&to=2026-11-26&limit=50",
    sampleOk: `{\n  "data": [{ "id": 1, "employeeId": 12, "workDate": "2026-11-26" }],\n  "limit": 50,\n  "offset": 0\n}`,
  },
  {
    path: "/branches",
    titleUz: "Filiallar",
    titleRu: "Филиалы",
    scope: "branches.read",
    summaryUz: "Filial mudirlari va joylashuv.",
    summaryRu: "Менеджеры филиалов и координаты.",
    params: [
      { name: "limit", example: "100", noteUz: "max 300", noteRu: "макс. 300" },
      { name: "offset", example: "0", noteUz: "Sahifa", noteRu: "Пагинация" },
    ],
    sampleQuery: "limit=100",
    sampleOk: `{ "data": [{ "id": 5, "fullName": "…", "branchNo": 3 }], "limit": 100, "offset": 0 }`,
  },
  {
    path: "/departments",
    titleUz: "Bo‘limlar",
    titleRu: "Отделы",
    scope: "departments.read",
    summaryUz: "Tashkilot bo‘limlari.",
    summaryRu: "Отделы организации.",
    params: [{ name: "limit", example: "100", noteUz: "max 300", noteRu: "макс. 300" }],
    sampleQuery: "limit=100",
    sampleOk: `{ "data": [{ "id": 1, "name": "HR", "headId": 2 }] }`,
  },
  {
    path: "/payroll",
    titleUz: "Oylik",
    titleRu: "Зарплата",
    scope: "payroll.read",
    summaryUz: "Oylik snapshot. month=YYYY-MM.",
    summaryRu: "Снимок зарплаты. month=YYYY-MM.",
    params: [
      { name: "month", example: "2026-11", noteUz: "YYYY-MM", noteRu: "YYYY-MM" },
      { name: "limit", example: "50", noteUz: "Sahifa o‘lchami", noteRu: "Размер страницы" },
      { name: "offset", example: "0", noteUz: "Ofset", noteRu: "Смещение" },
    ],
    sampleQuery: "month=2026-11&limit=50",
    sampleOk: `{ "data": [{ "id": 9, "userId": 3, "month": "2026-11" }], "month": "2026-11" }`,
  },
  {
    path: "/candidates",
    titleUz: "Nomzodlar",
    titleRu: "Кандидаты",
    scope: "candidates.read",
    summaryUz: "Ishga olish nomzodlari.",
    summaryRu: "Кандидаты на найм.",
    params: [
      { name: "limit", example: "50", noteUz: "Sahifa", noteRu: "Страница" },
      { name: "offset", example: "0", noteUz: "Ofset", noteRu: "Смещение" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 8, "fullName": "…", "stage": "interview" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/vacancies",
    titleUz: "Vakansiyalar",
    titleRu: "Вакансии",
    scope: "vacancies.read",
    summaryUz: "Ochiq / yopiq vakansiyalar.",
    summaryRu: "Открытые / закрытые вакансии.",
    params: [
      { name: "limit", example: "50", noteUz: "Sahifa", noteRu: "Страница" },
      { name: "offset", example: "0", noteUz: "Ofset", noteRu: "Смещение" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 4, "title": "Farmatsevt", "status": "open" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/tasks",
    titleUz: "Vazifalar",
    titleRu: "Задачи",
    scope: "tasks.read",
    summaryUz: "Topshiriqlar ro‘yxati.",
    summaryRu: "Список задач.",
    params: [
      { name: "limit", example: "50", noteUz: "Sahifa", noteRu: "Страница" },
      { name: "offset", example: "0", noteUz: "Ofset", noteRu: "Смещение" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 100, "title": "…", "status": "in_progress" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/users",
    titleUz: "Foydalanuvchilar",
    titleRu: "Пользователи",
    scope: "users.read",
    summaryUz: "Akkauntlar. login, parol, telegram, admin — hech qachon chiqmaydi.",
    summaryRu: "Аккаунты. login, пароль, telegram, admin — никогда не отдаются.",
    params: [
      { name: "limit", example: "50", noteUz: "Sahifa", noteRu: "Страница" },
      { name: "offset", example: "0", noteUz: "Ofset", noteRu: "Смещение" },
    ],
    sampleQuery: "limit=20",
    sampleOk: `{ "data": [{ "id": 1, "fullName": "…", "role": "hr", "status": "active" }], "limit": 20, "offset": 0 }`,
  },
  {
    path: "/discipline",
    titleUz: "Intizom",
    titleRu: "Дисциплина",
    scope: "discipline.read",
    summaryUz: "Intizom hodisalari. month=YYYY-MM.",
    summaryRu: "Дисциплинарные события. month=YYYY-MM.",
    params: [
      { name: "month", example: "2026-11", noteUz: "YYYY-MM", noteRu: "YYYY-MM" },
      { name: "limit", example: "100", noteUz: "max 500", noteRu: "макс. 500" },
    ],
    sampleQuery: "month=2026-11&limit=100",
    sampleOk: `{ "data": [{ "id": 3, "user_id": 12, "month": "2026-11", "kind": "late" }], "month": "2026-11" }`,
  },
];

/** UI uchun qulay alias */
export type DocEndpointView = DocEndpoint & { title: string; summary: string };

export function viewEndpoint(ep: DocEndpoint, lang: DocLang): DocEndpointView {
  const uz = lang !== "ru";
  return {
    ...ep,
    title: uz ? ep.titleUz : ep.titleRu,
    summary: uz ? ep.summaryUz : ep.summaryRu,
  };
}

export const OPEN_API_ERRORS = [
  {
    code: 401,
    titleUz: "Token yo‘q / noto‘g‘ri / muddati o‘tgan / bekor",
    titleRu: "Нет токена / неверный / истёк / отозван",
    whenUz: "Authorization yo‘q yoki token yaroqsiz",
    whenRu: "Нет Authorization или токен недействителен",
  },
  {
    code: 403,
    titleUz: "Scope yo‘q",
    titleRu: "Нет scope",
    whenUz: "Token bu endpoint uchun ruxsat etilmagan",
    whenRu: "У токена нет права на этот endpoint",
  },
  {
    code: 405,
    titleUz: "Faqat GET",
    titleRu: "Только GET",
    whenUz: "POST/PUT/PATCH/DELETE yuborilgan — o‘zgartirish taqiqlangan",
    whenRu: "Отправлен POST/PUT/PATCH/DELETE — изменение запрещено",
  },
  {
    code: 429,
    titleUz: "Juda ko‘p so‘rov",
    titleRu: "Слишком много запросов",
    whenUz: "Daqiqada 60–120 dan oshgan (IP+token)",
    whenRu: "Больше 60–120 запросов в минуту (IP+token)",
  },
  {
    code: 500,
    titleUz: "Server xatosi",
    titleRu: "Ошибка сервера",
    whenUz: "Ichki xato",
    whenRu: "Внутренняя ошибка",
  },
];

export function buildFullDocHtml(opts: { origin: string; generatedAt: string }): string {
  const base = `${opts.origin}/api/open/v1`;
  const wall = `${opts.origin}/open-api/v1`;

  const rows = OPEN_API_ENDPOINTS.map(
    (ep) => `
    <tr>
      <td style="padding:8pt;border:1pt solid #ddd;vertical-align:top">
        <b>UZ:</b> ${esc(ep.titleUz)}<br/>
        <b>RU:</b> ${esc(ep.titleRu)}
      </td>
      <td style="padding:8pt;border:1pt solid #ddd;font-family:Consolas;font-size:9pt">GET ${esc(ep.path)}</td>
      <td style="padding:8pt;border:1pt solid #ddd;font-family:Consolas;font-size:9pt">${esc(ep.scope || "any token")}</td>
      <td style="padding:8pt;border:1pt solid #ddd;font-size:9.5pt">
        <div><b>UZ:</b> ${esc(ep.summaryUz)}</div>
        <div style="margin-top:4pt"><b>RU:</b> ${esc(ep.summaryRu)}</div>
        ${
          ep.params.length
            ? `<div style="margin-top:6pt;color:#555">${ep.params
                .map(
                  (p) =>
                    `<code>${esc(p.name)}</code>=${esc(p.example)} — UZ: ${esc(p.noteUz)} / RU: ${esc(p.noteRu)}`,
                )
                .join("<br/>")}</div>`
            : ""
        }
        <div style="margin-top:6pt;font-family:Consolas;font-size:8.5pt;color:#4c1d95">${esc(base)}${esc(ep.path)}${ep.sampleQuery ? `?${esc(ep.sampleQuery)}` : ""}</div>
      </td>
    </tr>`,
  ).join("");

  const errRows = OPEN_API_ERRORS.map(
    (e) => `
    <tr>
      <td style="padding:8pt;border:1pt solid #ddd;font-weight:bold">${e.code}</td>
      <td style="padding:8pt;border:1pt solid #ddd"><b>UZ:</b> ${esc(e.titleUz)}<br/><span style="color:#666">${esc(e.whenUz)}</span></td>
      <td style="padding:8pt;border:1pt solid #ddd"><b>RU:</b> ${esc(e.titleRu)}<br/><span style="color:#666">${esc(e.whenRu)}</span></td>
    </tr>`,
  ).join("");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>VAKSINA Open API — UZ/RU</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
  @page { size: A4 landscape; margin: 1.4cm 1.6cm 1.4cm 1.6cm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; font-size: 11pt; line-height: 1.45; }
  h1 { color: #2e1065; font-size: 20pt; margin: 0 0 8pt; }
  h2 { color: #4c1d95; font-size: 13pt; margin: 16pt 0 8pt; border-bottom: 1.5pt solid #ddd6fe; padding-bottom: 4pt; }
  .box { background: #f5f3ff; border: 1pt solid #ddd6fe; border-radius: 6pt; padding: 10pt 12pt; margin: 8pt 0; }
  .warn { background: #fff7ed; border-color: #fed7aa; }
  .ok { background: #ecfdf5; border-color: #a7f3d0; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0 12pt; }
  th { background: #2e1065; color: #fff; padding: 8pt; text-align: left; font-size: 9.5pt; }
  code, .mono { font-family: Consolas, monospace; }
  .muted { color: #64748b; font-size: 9.5pt; }
  .two { display: table; width: 100%; }
  .two > div { display: table-cell; width: 50%; vertical-align: top; padding-right: 12pt; }
</style>
</head>
<body>
  <h1>VAKSINA HR — Open API (read-only) / Открытый API (только чтение)</h1>
  <p class="muted">Yaratilgan / Создано: ${esc(opts.generatedAt)} · UZ + RU</p>

  <div class="box ok">
    <b>UZ xavfsizlik:</b> Faqat GET. Login, parol, session, admin akkauntlari chiqmaydi. Token hash DB da. Bekor/o‘chirish — shu zahoti 401.<br/>
    <b>RU безопасность:</b> Только GET. Логин, пароль, session, admin-аккаунты не отдаются. В БД только hash. Отзыв/удаление — сразу 401.
  </div>

  <h2>1. Nima bu? / Что это?</h2>
  <div class="two">
    <div><b>O‘zbekcha.</b> Tashqi tizimlar (1C, BI, bot, Excel) uchun faqat o‘qish API. Ma’lumotni o‘zgartirish mumkin emas.</div>
    <div><b>Русский.</b> API только для чтения внешними системами (1C, BI, бот, Excel). Изменение данных невозможно.</div>
  </div>

  <h2>2. Token / Токен</h2>
  <div class="two">
    <div>
      <b>UZ:</b> Bosh admin → «API Tokenlar» → nom, scope, muddat → Yaratish → <code>vak_…</code> ni bir marta nusxa oling.
      Bekor/O‘chirish: shu zahoti ishlamaydi. Jurnal: «API Devor».
    </div>
    <div>
      <b>RU:</b> Главный админ → «API Tokenlar» → имя, scope, срок → Создать → скопируйте <code>vak_…</code> один раз.
      Отзыв/Удаление: сразу не работает. Журнал: «API Devor».
    </div>
  </div>

  <h2>3. URL</h2>
  <p><b>Asosiy / Основной:</b> <span class="mono">${esc(base)}</span></p>
  <p><b>Devor / Прокси:</b> <span class="mono">${esc(wall)}</span></p>

  <h2>4. Ulash / Подключение</h2>
  <div class="box">
    <b>Brauzer / Браузер:</b><br/>
    <span class="mono">${esc(base)}/employees?limit=20&amp;offset=0&amp;token=vak_XXXXXXXX</span><br/>
    <span class="muted">Havolani begonalarga bermang / Не делитесь ссылкой.</span>
  </div>
  <p><b>Header (tavsiya / рекомендуется):</b> <code>Authorization: Bearer vak_XXXXXXXX</code></p>
  <p class="mono">curl -sS -H "Authorization: Bearer vak_XXX" "${esc(base)}/health"</p>

  <h2>5. limit / offset</h2>
  <div class="two">
    <div>
      <b>UZ — limit:</b> bir so‘rovda nechta yozuv (default 50). Katta ro‘yxatni bo‘lib olish.<br/>
      <b>offset:</b> nechtasini o‘tkazib keyingi sahifa. 1: offset=0, 2: offset=20 (limit=20).<br/>
      <b>Rate limit:</b> daqiqada ~60–120 so‘rov — bu query limit EMAS (HTTP 429).
    </div>
    <div>
      <b>RU — limit:</b> сколько записей за запрос (по умолчанию 50). Большие списки — постранично.<br/>
      <b>offset:</b> сколько пропустить. Стр.1: offset=0, стр.2: offset=20 (limit=20).<br/>
      <b>Rate limit:</b> ~60–120 запросов/мин — это НЕ query limit (HTTP 429).
    </div>
  </div>

  <h2>6. Qoidalar / Правила (hakerlardan himoya)</h2>
  <ul>
    <li>UZ: Faqat GET — POST/PUT/DELETE 405. RU: Только GET — POST/PUT/DELETE → 405.</li>
    <li>UZ: Scope majburiy. RU: Scope обязателен.</li>
    <li>UZ: login/parol/admin yo‘q. RU: login/пароль/admin недоступны.</li>
    <li>UZ: Token bekor → hash buziladi, darhol 401. RU: Отзыв → hash сбрасывается, сразу 401.</li>
    <li>UZ: Hujjatni ko‘rish hujumni ochmaydi — tokensiz hech narsa. RU: Просмотр docs не даёт доступа — без токена ничего.</li>
  </ul>

  <h2>7. Xato kodlari / Коды ошибок</h2>
  <table>
    <tr><th style="width:70px">HTTP</th><th>O‘zbekcha</th><th>Русский</th></tr>
    ${errRows}
  </table>

  <h2>8. Endpointlar / Эндпоинты</h2>
  <table>
    <tr>
      <th style="width:18%">Nom / Название</th>
      <th style="width:16%">Path</th>
      <th style="width:14%">Scope</th>
      <th>Tavsif / Описание + parametrlar</th>
    </tr>
    ${rows}
  </table>

  <h2>9. Tezkor jadval / Быстрая таблица</h2>
  <table>
    <tr><th>UZ</th><th>RU</th><th>GET</th><th>Scope</th></tr>
    ${OPEN_API_ENDPOINTS.filter((e) => e.scope)
      .map(
        (e) =>
          `<tr><td style="padding:6pt;border:1pt solid #ddd">${esc(e.titleUz)}</td><td style="padding:6pt;border:1pt solid #ddd">${esc(e.titleRu)}</td><td style="padding:6pt;border:1pt solid #ddd;font-family:Consolas;font-size:9pt">${esc(e.path)}</td><td style="padding:6pt;border:1pt solid #ddd;font-family:Consolas;font-size:9pt">${esc(e.scope!)}</td></tr>`,
      )
      .join("")}
  </table>

  <div class="box warn">
    <b>UZ:</b> Hujjat ochiq — lekin ma’lumot faqat yaroqli token bilan. Tokenni oshkor qilmang.<br/>
    <b>RU:</b> Документация открыта — данные только с валидным токеном. Не раскрывайте токен.
  </div>
  <p class="muted">© VAKSINA HR · Open API v1 · UZ/RU</p>
</body>
</html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Eski matn eksporti (fallback) */
export function buildFullDocText(opts: { origin: string; generatedAt: string }) {
  return buildFullDocHtml(opts).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
