declare const __APP_BUILD__: { version: string; commit: string; builtAt: string } | undefined;

const build = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : { version: "", commit: "", builtAt: "" };

export const APP_VERSION = build.version ? `v ${build.version}` : "dev";

const builtAt = build.builtAt ? new Date(build.builtAt) : null;

const part = (opts: Intl.DateTimeFormatOptions) =>
  builtAt ? new Intl.DateTimeFormat("uz-UZ", { timeZone: "Asia/Tashkent", ...opts }).format(builtAt) : "";

/** «15.10.2026» */
export const APP_UPDATED_DATE = part({ day: "2-digit", month: "2-digit", year: "numeric" });
/** «16:44» */
export const APP_UPDATED_TIME = part({ hour: "2-digit", minute: "2-digit", hour12: false });
