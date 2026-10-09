import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env";

// Scans the @swagger JSDoc blocks above each route definition — the routes
// files are the single source of truth for the documented API surface, not
// a hand-written spec that could drift from the actual code.
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "Ride Sharing POC API",
      version: "0.1.0",
      description:
        "Scheduled ride-sharing / carpool-matching API. Auth is cookie-based (httpOnly `token` cookie, not a bearer token) — " +
        "use the 'Try it out' flow in order (signup/login first) so the browser's cookie jar carries the session into later calls. " +
        "Mutating requests (POST/PATCH/PUT/DELETE) also require an `X-Requested-With: XMLHttpRequest` header.",
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: "Local dev server" }],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "token",
        },
      },
    },
  },
  // Covers both `npm run dev` (tsx runs the .ts source directly) and the
  // compiled production build (`dist/`) — JSDoc comments survive tsc's
  // default output since `removeComments` isn't set in tsconfig.json.
  apis: ["./src/modules/**/*.routes.ts", "./dist/modules/**/*.routes.js"],
};

export const swaggerSpec = swaggerJsdoc(options);
