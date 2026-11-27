import express, { type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "node:crypto";
import { registerRoutes, type RouteOptions } from "./routes";
import { WebhookHandlers, WebhookSignatureError } from "./webhookHandlers";
import { BillingUnavailableError } from "./stripeClient";
import { trustProxySetting } from "./config";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

/** Build the API application (no static/Vite serving). Used by the server and by integration tests. */
export async function createApp(options: RouteOptions = {}): Promise<{ app: express.Express; httpServer: Server }> {
  const app = express();
  const httpServer = createServer(app);
  app.set("trust proxy", trustProxySetting());
  app.disable("x-powered-by");

  // Raw body is required for signature verification, so this precedes the JSON parser.
  app.post("/api/stripe/webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) return res.status(400).json({ error: "Missing stripe-signature" });
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, Array.isArray(signature) ? signature[0] : signature);
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof WebhookSignatureError) {
        console.error(JSON.stringify({ event: "webhook_rejected" }));
        return res.status(400).json({ error: "Invalid webhook" });
      }
      // Non-2xx makes Stripe retry delivery; fulfillment is idempotent.
      console.error(JSON.stringify({ event: "webhook_processing_error", unavailable: error instanceof BillingUnavailableError }));
      res.status(500).json({ error: "Webhook processing error" });
    }
  });

  app.use((req, res, next) => {
    const start = Date.now();
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.on("finish", () => {
      if (req.path.startsWith("/api")) {
        console.log(JSON.stringify({ event: "api_request", requestId, method: req.method, path: req.route?.path ?? req.path.split("/").slice(0, 3).join("/"), status: res.statusCode, durationMs: Date.now() - start }));
      }
    });
    next();
  });

  // Non-auth JSON bodies (rubrics, defense answers). Auth routes use a stricter 16 kb parser; uploads use multipart.
  const json = express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } });
  const form = express.urlencoded({ extended: false, limit: "100kb" });
  app.use((req, res, next) => (req.path.startsWith("/api/auth/") ? next() : json(req, res, (err) => (err ? next(err) : form(req, res, next)))));

  await registerRoutes(httpServer, app, options);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    console.error(JSON.stringify({ event: "request_error", status }));
    if (res.headersSent) return next(err);
    return res.status(status).json({ message: status >= 500 ? "Internal Server Error" : "Invalid request" });
  });

  return { app, httpServer };
}
