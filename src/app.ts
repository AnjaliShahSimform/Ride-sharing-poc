import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import { requireCsrfHeader } from "./middleware/csrf";
import { errorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimit";
import { env } from "./config/env";
import { swaggerSpec } from "./config/swagger";
import { adminRouter } from "./modules/admin/admin.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { bookingsRouter } from "./modules/bookings/bookings.routes";
import { ridesRouter } from "./modules/rides/rides.routes";
import { vehiclesRouter } from "./modules/vehicles/vehicles.routes";
import { logger } from "./lib/logger";

export const app = express();

// Render terminates TLS at a proxy in front of the app; without this every
// client's req.ip is the proxy's, and one rate-limit bucket would be shared by
// all users. 1 = trust exactly one proxy hop.
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin === env.FRONTEND_ORIGIN);
    },
    credentials: true,
  }),
);
// After cors so a 429 still carries CORS headers (the browser can read it),
// before everything else so rejected traffic costs as little as possible.
app.use(globalLimiter);
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

// Swagger UI's inline bundle-init script and styles need a relaxed CSP —
// helmet's global default (script-src 'self', style-src 'self') would
// otherwise silently block the page from rendering. Scoped to this one
// route only; every other route keeps helmet's strict default.
app.use(
  "/api-docs",
  (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.removeHeader("Content-Security-Policy");
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec),
);

app.use("/api/auth", authRouter);
app.use("/api/rides", ridesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/admin", adminRouter);

// No route matched anything above this line.
app.use((req, res) => {
  res.status(404).json({ error: "NotFound", message: `No route for ${req.method} ${req.path}` });
});

// Error handler must be last: Express only routes to a 4-arg middleware
// when something calls next(err).
app.use(errorHandler);
