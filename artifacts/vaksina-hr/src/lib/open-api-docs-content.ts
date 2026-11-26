/** VAKSINA Open API — hujjat matnlari UZ + RU (sahifa + Word) */

export type DocLang = "uz" | "ru" | "both";
export type DocLangSingle = "uz" | "ru";

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

const COPY = {
  uz: {
    title: "VAKSINA HR — Open API (faqat o‘qish)",
    langTag: "O‘zbekcha",
    created: "Yaratilgan",
    security:
      "Xavfsizlik: faqat GET. Login, parol, session, admin akkauntlari chiqmaydi. Token DB da faqat hash. Bekor/o‘chirish — shu zahoti 401.",
    s1: "1. Nima bu?",
    s1body:
      "Tashqi tizimlar (1C, BI, bot, Excel) uchun faqat o‘qish API. Ma’lumotni o‘zgartirish mumkin emas.",
    s2: "2. Token olish",
    s2body:
      "Bosh admin → «API Tokenlar» → nom, scope, muddat → Yaratish → vak_… ni bir marta nusxa oling. Bekor/O‘chirish: shu zahoti ishlamaydi. Jurnal: «API Devor».",
    s3: "3. URL manzillar",
    mainUrl: "Asosiy",
    wallUrl: "Devor (proxy)",
    s4: "4. Ulash",
    browser: "Brauzer (tez sinov)",
    browserWarn: "Havolani begonalarga bermang — token URL da ko‘rinadi.",
    headerRec: "Header (tavsiya etiladi)",
    s5: "5. limit va offset",
    s5limit:
      "limit — bir so‘rovda nechta yozuv (odatda 50). Katta ro‘yxatni bo‘lib olish uchun.",
    s5offset:
      "offset — nechtasini o‘tkazib keyingi sahifa. 1-sahifa: offset=0; 2-sahifa: offset=20 (limit=20).",
    s5rate:
      "Rate limit — daqiqada ~60–120 so‘rov (HTTP 429). Bu query dagi limit emas.",
    s6: "6. Himoya qoidalari",
    rules: [
      "Faqat GET — POST / PUT / PATCH / DELETE → 405.",
      "Scope majburiy — ruxsatsiz endpoint → 403.",
      "login / parol / admin akkauntlari hech qachon chiqmaydi.",
      "Token bekor yoki o‘chirilsa — hash buziladi, darhol 401.",
    ],
    s7: "7. Xato kodlari",
    thHttp: "HTTP",
    thMeaning: "Ma’nosi",
    thWhen: "Qachon",
    s8: "8. Endpointlar (batafsil)",
    thName: "Bo‘lim",
    thPath: "So‘rov",
    thScope: "Scope",
    params: "Parametrlar",
    sample: "Namuna URL",
    s9: "9. Tezkor ro‘yxat",
    footerWarn:
      "Hujjat ochiq — lekin ma’lumot faqat yaroqli token bilan. Tokenni oshkor qilmang.",
    footer: "© VAKSINA HR · Open API v1 · UZ",
    anyToken: "har qanday token",
  },
  ru: {
    title: "VAKSINA HR — Open API (только чтение)",
    langTag: "Русский",
    created: "Создано",
    security:
      "Безопасность: только GET. Логин, пароль, session, admin-аккаунты не отдаются. В БД только hash токена. Отзыв/удаление — сразу 401.",
    s1: "1. Что это?",
    s1body:
      "API только для чтения внешними системами (1C, BI, бот, Excel). Изменение данных невозможно.",
    s2: "2. Получение токена",
    s2body:
      "Главный админ → «API Tokenlar» → имя, scope, срок → Создать → скопируйте vak_… один раз. Отзыв/Удаление: сразу не работает. Журнал: «API Devor».",
    s3: "3. URL-адреса",
    mainUrl: "Основной",
    wallUrl: "Прокси (Devor)",
    s4: "4. Подключение",
    browser: "Браузер (быстрый тест)",
    browserWarn: "Не делитесь ссылкой — токен виден в URL.",
    headerRec: "Header (рекомендуется)",
    s5: "5. limit и offset",
    s5limit:
      "limit — сколько записей за один запрос (обычно 50). Большие списки — постранично.",
    s5offset:
      "offset — сколько строк пропустить. Стр.1: offset=0; стр.2: offset=20 (limit=20).",
    s5rate:
      "Rate limit — ~60–120 запросов в минуту (HTTP 429). Это НЕ query-параметр limit.",
    s6: "6. Правила защиты",
    rules: [
      "Только GET — POST / PUT / PATCH / DELETE → 405.",
      "Scope обязателен — без права → 403.",
      "login / пароль / admin-аккаунты никогда не отдаются.",
      "Отзыв или удаление токена — hash сбрасывается, сразу 401.",
    ],
    s7: "7. Коды ошибок",
    thHttp: "HTTP",
    thMeaning: "Значение",
    thWhen: "Когда",
    s8: "8. Эндпоинты (подробно)",
    thName: "Раздел",
    thPath: "Запрос",
    thScope: "Scope",
    params: "Параметры",
    sample: "Пример URL",
    s9: "9. Краткий список",
    footerWarn:
      "Документация открыта — данные только с валидным токеном. Не раскрывайте токен.",
    footer: "© VAKSINA HR · Open API v1 · RU",
    anyToken: "любой токен",
  },
} as const;

export function buildFullDocHtml(opts: {
  origin: string;
  generatedAt: string;
  lang?: DocLangSingle;
}): string {
  const lang: DocLangSingle = opts.lang === "ru" ? "ru" : "uz";
  const t = COPY[lang];
  const base = `${opts.origin}/api/open/v1`;
  const wall = `${opts.origin}/open-api/v1`;

  const errRows = OPEN_API_ERRORS.map((e) => {
    const title = lang === "ru" ? e.titleRu : e.titleUz;
    const when = lang === "ru" ? e.whenRu : e.whenUz;
    return `<tr>
      <td class="c-code">${e.code}</td>
      <td class="c-cell">${esc(title)}</td>
      <td class="c-cell">${esc(when)}</td>
    </tr>`;
  }).join("");

  const endpointBlocks = OPEN_API_ENDPOINTS.map((ep, i) => {
    const title = lang === "ru" ? ep.titleRu : ep.titleUz;
    const summary = lang === "ru" ? ep.summaryRu : ep.summaryUz;
    const scope = ep.scope || t.anyToken;
    const sampleUrl = `${base}${ep.path}${ep.sampleQuery ? `?${ep.sampleQuery}` : ""}`;
    const paramsHtml = ep.params.length
      ? `<table class="inner">
          <tr><th>${esc(t.params)}</th><th>example</th><th></th></tr>
          ${ep.params
            .map((p) => {
              const note = lang === "ru" ? p.noteRu : p.noteUz;
              return `<tr>
                <td class="mono">${esc(p.name)}</td>
                <td class="mono">${esc(p.example)}</td>
                <td>${esc(note)}</td>
              </tr>`;
            })
            .join("")}
        </table>`
      : "";

    return `
    <table class="ep">
      <tr>
        <td class="ep-num" width="36">${i + 1}</td>
        <td class="ep-title">${esc(title)}</td>
        <td class="ep-meta" width="280">
          <div class="mono">GET ${esc(ep.path)}</div>
          <div class="mono muted">${esc(scope)}</div>
        </td>
      </tr>
      <tr>
        <td colspan="3" class="ep-body">
          <p class="sum">${esc(summary)}</p>
          ${paramsHtml}
          <p class="sample-label">${esc(t.sample)}</p>
          <p class="url">${esc(sampleUrl)}</p>
        </td>
      </tr>
    </table>`;
  }).join("");

  const quickRows = OPEN_API_ENDPOINTS.map((ep) => {
    const title = lang === "ru" ? ep.titleRu : ep.titleUz;
    return `<tr>
      <td class="c-cell">${esc(title)}</td>
      <td class="mono c-cell">GET ${esc(ep.path)}</td>
      <td class="mono c-cell">${esc(ep.scope || t.anyToken)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${esc(t.title)}</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  /* Word: oddiy jadval + word-wrap — matn katakdan chiqib ketmasin */
  @page WordSection1 {
    size: 297mm 210mm;
    margin: 1.5cm 1.6cm 1.5cm 1.6cm;
  }
  div.WordSection1 { page: WordSection1; }
  body {
    font-family: Arial, "Segoe UI", sans-serif;
    color: #0f172a;
    font-size: 11pt;
    line-height: 1.4;
    margin: 0;
  }
  h1 { color: #2e1065; font-size: 18pt; margin: 0 0 6pt 0; }
  h2 {
    color: #4c1d95;
    font-size: 13pt;
    margin: 14pt 0 6pt 0;
    border-bottom: 1.5pt solid #c4b5fd;
    padding-bottom: 3pt;
  }
  p { margin: 0 0 6pt 0; }
  ul { margin: 4pt 0 8pt 18pt; padding: 0; }
  li { margin: 0 0 3pt 0; }
  .muted { color: #64748b; font-size: 9.5pt; }
  .mono { font-family: Consolas, "Courier New", monospace; font-size: 9pt; }
  .box {
    border: 1pt solid #c4b5fd;
    background: #f5f3ff;
    padding: 8pt 10pt;
    margin: 6pt 0 10pt 0;
  }
  .box.ok { border-color: #6ee7b7; background: #ecfdf5; }
  .box.warn { border-color: #fdba74; background: #fff7ed; }
  table.grid {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    margin: 6pt 0 10pt 0;
  }
  table.grid th {
    background: #2e1065;
    color: #fff;
    padding: 6pt 7pt;
    text-align: left;
    font-size: 9.5pt;
    border: 1pt solid #2e1065;
  }
  table.grid td.c-code {
    width: 56px;
    font-weight: bold;
    text-align: center;
    vertical-align: top;
    padding: 6pt;
    border: 1pt solid #d4d4d8;
  }
  table.grid td.c-cell {
    vertical-align: top;
    padding: 6pt 7pt;
    border: 1pt solid #d4d4d8;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  table.ep {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    margin: 0 0 10pt 0;
    border: 1pt solid #c4b5fd;
  }
  table.ep td.ep-num {
    background: #2e1065;
    color: #fff;
    font-weight: bold;
    text-align: center;
    vertical-align: middle;
    padding: 8pt 4pt;
    border: 1pt solid #2e1065;
  }
  table.ep td.ep-title {
    background: #ede9fe;
    font-weight: bold;
    font-size: 11pt;
    vertical-align: middle;
    padding: 8pt 10pt;
    border: 1pt solid #c4b5fd;
    word-wrap: break-word;
  }
  table.ep td.ep-meta {
    background: #f8fafc;
    vertical-align: middle;
    padding: 6pt 8pt;
    border: 1pt solid #c4b5fd;
    word-wrap: break-word;
  }
  table.ep td.ep-body {
    padding: 8pt 10pt;
    border: 1pt solid #c4b5fd;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  table.ep p.sum { margin: 0 0 6pt 0; }
  table.ep p.sample-label {
    margin: 8pt 0 2pt 0;
    font-size: 9pt;
    color: #64748b;
    font-weight: bold;
  }
  p.url, table.ep p.url {
    margin: 0;
    font-family: Consolas, "Courier New", monospace;
    font-size: 8.5pt;
    color: #4c1d95;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  table.inner {
    border-collapse: collapse;
    width: 100%;
    table-layout: fixed;
    margin: 4pt 0;
  }
  table.inner th {
    background: #f1f5f9;
    color: #334155;
    font-size: 8.5pt;
    text-align: left;
    padding: 4pt 6pt;
    border: 1pt solid #e2e8f0;
  }
  table.inner td {
    font-size: 9pt;
    padding: 4pt 6pt;
    border: 1pt solid #e2e8f0;
    vertical-align: top;
    word-wrap: break-word;
  }
</style>
</head>
<body>
<div class="WordSection1">

  <h1>${esc(t.title)}</h1>
  <p class="muted">${esc(t.created)}: ${esc(opts.generatedAt)} · ${esc(t.langTag)}</p>

  <div class="box ok">${esc(t.security)}</div>

  <h2>${esc(t.s1)}</h2>
  <p>${esc(t.s1body)}</p>

  <h2>${esc(t.s2)}</h2>
  <p>${esc(t.s2body)}</p>

  <h2>${esc(t.s3)}</h2>
  <table class="grid">
    <tr>
      <th style="width:22%">${esc(t.mainUrl)}</th>
      <td class="c-cell mono">${esc(base)}</td>
    </tr>
    <tr>
      <th>${esc(t.wallUrl)}</th>
      <td class="c-cell mono">${esc(wall)}</td>
    </tr>
  </table>

  <h2>${esc(t.s4)}</h2>
  <div class="box">
    <p><b>${esc(t.browser)}</b></p>
    <p class="url mono">${esc(base)}/employees?limit=20&amp;offset=0&amp;token=vak_XXXXXXXX</p>
    <p class="muted">${esc(t.browserWarn)}</p>
  </div>
  <p><b>${esc(t.headerRec)}:</b></p>
  <p class="mono">Authorization: Bearer vak_XXXXXXXX</p>
  <p class="mono">curl -sS -H "Authorization: Bearer vak_XXX" "${esc(base)}/health"</p>

  <h2>${esc(t.s5)}</h2>
  <ul>
    <li>${esc(t.s5limit)}</li>
    <li>${esc(t.s5offset)}</li>
    <li>${esc(t.s5rate)}</li>
  </ul>

  <h2>${esc(t.s6)}</h2>
  <ul>
    ${t.rules.map((r) => `<li>${esc(r)}</li>`).join("\n    ")}
  </ul>

  <h2>${esc(t.s7)}</h2>
  <table class="grid">
    <tr>
      <th style="width:56px">${esc(t.thHttp)}</th>
      <th style="width:38%">${esc(t.thMeaning)}</th>
      <th>${esc(t.thWhen)}</th>
    </tr>
    ${errRows}
  </table>

  <h2>${esc(t.s8)}</h2>
  ${endpointBlocks}

  <h2>${esc(t.s9)}</h2>
  <table class="grid">
    <tr>
      <th style="width:28%">${esc(t.thName)}</th>
      <th style="width:36%">${esc(t.thPath)}</th>
      <th>${esc(t.thScope)}</th>
    </tr>
    ${quickRows}
  </table>

  <div class="box warn">${esc(t.footerWarn)}</div>
  <p class="muted">${esc(t.footer)}</p>

</div>
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
export function buildFullDocText(opts: {
  origin: string;
  generatedAt: string;
  lang?: DocLangSingle;
}) {
  return buildFullDocHtml(opts).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
