import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensurePersistentSchema, ensureEmployeesOrgColumns } from "./lib/ensure-schema";

const app: Express = express();

/**
 * Schema ensure — eng yaxshi urinish.
 * Vercel/Railway timeout bo‘lsa ham login va API ishlashi kerak (bloklamaymiz).
 * Vercel’da to‘liq DDL o‘tkazilmaydi; faqat employees org ustunlari (kuzatuv uchun) tekshiriladi.
 */
const schemaReady =
  process.env.VERCEL === "1" || process.env.VERCEL === "true"
    ? ensureEmployeesOrgColumns().catch((err) => {
        logger.error({ err }, "Employees org columns ensure failed (non-blocking)");
      })
    : ensurePersistentSchema().catch((err) => {
        logger.error({ err }, "Schema ensure failed (non-blocking)");
      });

app.use(async (_req, _res, next) => {
  await schemaReady;
  next();
});

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
