import { Hono } from "hono";
import { getKryzNetApiUrl } from "../lib/kryznet.js";

export const proxyRouter = new Hono();

// Proxy all /api/v1/* requests to Kryz-Net provider API
proxyRouter.all("/*", async (c) => {
  const apiUrl = getKryzNetApiUrl();
  const urlObj = new URL(c.req.raw.url);
  const targetUrl = `${apiUrl}${urlObj.pathname}${urlObj.search}`;

  try {
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("accept-encoding");

    const body = ["GET", "HEAD"].includes(c.req.method)
      ? undefined
      : await c.req.text();

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body,
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
    console.error(`[API V1 PROXY] Error forwarding to ${targetUrl}:`, message);
    return c.json({ error: "Failed to forward request to backend API", details: message }, 500);
  }
});
