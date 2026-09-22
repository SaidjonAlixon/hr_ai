import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  ensurePersistentSchema,
  ensureEmployeesOrgColumns,
  ensureCandidatePipelineColumns,
  ensureLokatsiyaBotSchema,
  ensureStaffNeedRequestsSchema,
} from "./lib/ensure-schema";

const app: Express = express();

/**
 * Schema ensure — eng yaxshi urinish.
 * Vercel’da loginni bloklamaydi: fon rejimida ishlaydi (pool 1 ta ulanishni ushlab qolmasin).
 */
if (process.env.VERCEL === "1" || process.env.VERCEL === "true") {
  void ensureEmployeesOrgColumns().catch((err) => {
    logger.error({ err }, "Critical columns ensure failed (non-blocking)");
  });
  void ensureLokatsiyaBotSchema().catch((err) => {
    logger.warn({ err }, "Lokatsiya bot schema ensure failed (non-blocking)");
  });
  void ensureStaffNeedRequestsSchema().catch((err) => {
    logger.warn({ err }, "Staff need requests schema ensure failed (non-blocking)");
  });
  // Filial bot webhook — lokal polling o‘chirib yubormasin; Vercelda qayta o‘rnatiladi
  void import("./lib/telegram-filial")
    .then(({ ensureFilialWebhookOnServerless }) => ensureFilialWebhookOnServerless())
    .then((r) => {
      if (r?.ok) logger.info({ url: r.url, note: r.note }, "Filial bot webhook ensure");
      else if (r?.note) logger.warn({ note: r.note }, "Filial bot webhook ensure skip");
    })
    .catch((err) => logger.warn({ err }, "Filial bot webhook ensure failed"));
} else {
  void ensurePersistentSchema().catch((err) => {
    logger.error({ err }, "Schema ensure failed (non-blocking)");
  });
  void ensureCandidatePipelineColumns().catch((err) => {
    logger.error({ err }, "Candidate pipeline columns ensure failed (non-blocking)");
  });
  void ensureLokatsiyaBotSchema().catch((err) => {
    logger.warn({ err }, "Lokatsiya bot schema ensure failed (non-blocking)");
  });
  void ensureStaffNeedRequestsSchema().catch((err) => {
    logger.warn({ err }, "Staff need requests schema ensure failed (non-blocking)");
  });
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api", router);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled API error");
  if (res.headersSent) return;
  const message =
    err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ETIMEDOUT"
      ? "Baza bilan aloqa yo‘q — birozdan keyin qayta urinib ko‘ring"
      : "Server xatosi";
  res.status(503).json({ error: message });
});

export default app;
