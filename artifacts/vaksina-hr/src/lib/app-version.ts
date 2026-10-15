declare const __APP_BUILD__: { version: string; commit: string; builtAt: string } | undefined;

const build = typeof __APP_BUILD__ !== "undefined" ? __APP_BUILD__ : { version: "", commit: "", builtAt: "" };

export const APP_VERSION = build.version ? `v${build.version}` : "dev";

export const APP_VERSION_TITLE = [
  `Versiya ${APP_VERSION}`,
  build.commit ? `commit ${build.commit}` : null,
  build.builtAt
    ? `yangilangan ${new Intl.DateTimeFormat("uz-UZ", {
        timeZone: "Asia/Tashkent",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(build.builtAt))}`
    : null,
]
  .filter(Boolean)
  .join(" · ");
