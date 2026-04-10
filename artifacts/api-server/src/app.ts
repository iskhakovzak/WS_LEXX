import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";

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
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

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
  const message =
    status < 500 && err instanceof Error
      ? err.message
      : isProduction
        ? "Internal server error"
        : err instanceof Error
          ? err.message
          : "Internal server error";
  res.status(status).json({ error: message });
});

export default app;
