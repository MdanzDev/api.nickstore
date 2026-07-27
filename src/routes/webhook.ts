import { Hono } from "hono";
import { getKryzNetApiUrl } from "../lib/kryznet.js";

export const webhookRouter = new Hono();

// Forward webhook callbacks to Kryz-Net
webhookRouter.all("/", async (c) => {
  const apiUrl = getKryzNetApiUrl();

  try {
    const body = await c.req.text();
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");

    console.log(`[WEBHOOK] Received callback, forwarding to ${apiUrl}...`);

    const response = await fetch(`${apiUrl}/api/callback`, {
      method: c.req.method,
      headers,
      body: ["GET", "HEAD"].includes(c.req.method) ? undefined : body,
    });

    const resHeaders = new Headers(response.headers);
    resHeaders.delete("content-encoding");
    resHeaders.delete("content-length");
    resHeaders.delete("transfer-encoding");

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[WEBHOOK] Error forwarding callback:`, message);
    return c.json({ error: "Failed to forward callback" }, 500);
  }
});
