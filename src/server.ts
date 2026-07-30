import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { botApiRouter } from "./routes/bot-api.js";
import { imagesRouter } from "./routes/images.js";
import { proxyRouter } from "./routes/proxy.js";
import { cronRouter } from "./routes/cron.js";
import { webhookRouter } from "./routes/webhook.js";

const app = new Hono();

// --- CORS ---
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Bot-ID",
      "X-Timestamp",
      "X-Signature",
      "X-Admin-Token",
      "X-Bot-Secret",
      "X-API-KEY",
      "Idempotency-Key",
    ],
  })
);

// --- Request Logger (added) ---
app.use("*", async (c, next) => {
  const start = Date.now();
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.raw.socket?.remoteAddress ||
    "unknown";

  await next();

  const ms = Date.now() - start;
  const status = c.res.status;
  const method = c.req.method;
  const url = c.req.url;

  console.log(
    `[${new Date().toISOString()}] ${method} ${url} - ${status} - ${ms}ms - ${ip}`
  );
});

// --- Health Check ---
app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "api.nickstore",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  })
);

// --- Image Proxy ---
app.route("/img", imagesRouter);

// --- Webhook Callback ---
app.all("/api/callback", async (c) => {
  // Delegate to webhook router
  const webhookApp = new Hono();
  webhookApp.route("/", webhookRouter);
  return webhookApp.fetch(c.req.raw);
});

// --- Cron Jobs ---
app.route("/api/cron", cronRouter);

// --- Bot REST API & Admin Endpoints ---
app.route("/api", botApiRouter);

// --- V1 API Proxy to Kryz-Net (must come AFTER bot-api) ---
app.route("/api/v1", proxyRouter);

// --- Catch-all ---
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

app.get("/", (c) =>
  c.json({
    service: "NickStore API Server",
    version: "1.0.0",
    endpoints: [
      "GET  /health",
      "GET  /img/:filename",
      "ALL  /api/callback",
      "ALL  /api/cron/sync",
      "GET  /api/products",
      "POST /api/account/validate",
      "POST /api/order/create",
      "GET  /api/order/status/:id",
      "GET  /api/user/account/:telegram_id",
      "GET  /api/user/history/:telegram_id",
      "POST /api/auth/otp/send",
      "POST /api/auth/otp/verify",
      "POST /api/admin/refund",
      "GET  /api/admin/provider/balance",
      "POST /api/cron/products-sync",
      "ALL  /api/v1/* (proxy to Kryz-Net)",
    ],
  })
);

// --- Start Server ---
const port = parseInt(process.env.PORT || "4000");

serve({ fetch: app.fetch, port }, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║         NickStore API Server v1.0.0          ║
╠══════════════════════════════════════════════╣
║  🚀 Running on http://localhost:${port}         ║
║  📡 Health:   http://localhost:${port}/health    ║
║  🤖 Bot API:  http://localhost:${port}/api       ║
║  🔄 Proxy:    http://localhost:${port}/api/v1    ║
╚══════════════════════════════════════════════╝
  `);
});

export { app };