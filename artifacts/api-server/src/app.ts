import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware, apiAuthGate } from "./lib/auth";
import { jsonCompression } from "./lib/jsonCompression";
import { requestLang } from "./i18n";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

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
const allowedOrigins = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .flatMap((d) => [`https://${d}`, `http://${d}`]);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (process.env.NODE_ENV !== "production") return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа, попробуйте позже" },
});
app.use("/api/auth/login", loginLimiter);

const guestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много запросов, попробуйте позже", code: "RATE_LIMITED" },
});
app.use("/api/auth/guest", guestLimiter);

// Same budget as login: POST /auth/init-passwords is public (first-run bootstrap) and takes a secret.
const initPasswordsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Слишком много попыток, попробуйте позже", code: "RATE_LIMITED" },
});
app.use("/api/auth/init-passwords", initPasswordsLimiter);

// Every /api/* request needs a valid token (member or guest). The explicit allowlist
// (method + path) lives next to the gate in lib/auth.ts: PUBLIC_API_ROUTES.
// Anonymous → 401 «Требуется вход»; guest on any mutation → 403 «Гостевой режим: только просмотр».
// gzip for JSON answers ≥ 16 KB (lib/jsonCompression: res.json only — streams, SSE and files are untouched).
app.use("/api", jsonCompression());
// requestLang: req.lang from X-Lang → users.locale → "ru" (src/i18n); adds Vary: X-Lang.
app.use("/api", authMiddleware, apiAuthGate, requestLang, router);

if (process.env.NODE_ENV === "production") {
  const staticDir = path.resolve(__dirname, "public");
  app.use(express.static(staticDir));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

interface HttpError extends Error {
  status?: number;
  statusCode?: number;
}

function getHttpStatus(err: unknown): number {
  if (err && typeof err === "object") {
    if ("status" in err && typeof (err as HttpError).status === "number") {
      return (err as HttpError).status!;
    }
    if ("statusCode" in err && typeof (err as HttpError).statusCode === "number") {
      return (err as HttpError).statusCode!;
    }
  }
  return 500;
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = getHttpStatus(err);
  logger.error({ err }, "Unhandled route error");
  const isProduction = process.env.NODE_ENV === "production";
  // Malformed JSON bodies arrive here from express.json() with status 400.
  const message =
    status === 400 && err instanceof Error && (err as HttpError & { type?: string }).type === "entity.parse.failed"
      ? "Некорректный JSON в теле запроса"
      : status < 500 && err instanceof Error
        ? err.message
        : isProduction
          ? "Внутренняя ошибка сервера"
          : err instanceof Error
            ? err.message
            : "Внутренняя ошибка сервера";
  res.status(status).json({ error: message, ...(status >= 500 ? { code: "INTERNAL" } : {}) });
});

export default app;
