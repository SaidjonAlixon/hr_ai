/** Open API to‘liq qo‘llanma — Word (.doc) UZ+RU, keng landscape */

import { buildFullDocHtml } from "./open-api-docs-content";

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function downloadOpenApiWordDoc(origin = window.location.origin) {
  const generatedAt = new Date().toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
  const html = buildFullDocHtml({ origin, generatedAt });
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VAKSINA_Open_API_UZ_RU_${stamp()}.doc`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
