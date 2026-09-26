import type { JwtPayload } from "../lib/jwt";

// Augments Express's own Request type so `req.user` is known everywhere,
// instead of every handler casting `req` to `any`.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export {};
