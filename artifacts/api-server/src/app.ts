import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { ensurePersistentSchema } from "./lib/ensure-schema";

const app: Express = express();

/** Bir marta schema ta’minlash (restart/reinstall da ma’lumot o‘chmaydi) */
const schemaReady = ensurePersistentSchema().catch((err) => {
  logger.error({ err }, "Schema ensure failed");
  throw err;
});

app.use(async (_req, _res, next) => {
  try {
    await schemaReady;
    next();
  } catch (err) {
    next(err);
  }
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

export default app;
