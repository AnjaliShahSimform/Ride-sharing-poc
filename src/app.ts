import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import { requireCsrfHeader } from "./middleware/csrf";
import { errorHandler } from "./middleware/errorHandler";
import { env } from "./config/env";
import { authRouter } from "./modules/auth/auth.routes";
import { ridesRouter } from "./modules/rides/rides.routes";
import { logger } from "./lib/logger";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin === env.FRONTEND_ORIGIN);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json());
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.headers["x-request-id"]?.toString() ?? randomUUID(),
  }),
);
// Runs after the logger so a CSRF rejection is still captured in request
// logs; must still run before both routers.
app.use(requireCsrfHeader);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/rides", ridesRouter);

// No route matched anything above this line.
app.use((req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.path}` });
});

// Error handler must be last: Express only routes to a 4-arg middleware
// when something calls next(err).
app.use(errorHandler);
