import { Hono } from "hono";
import { getKryzNetApiUrl, getKryzNetApiKey } from "../lib/kryznet.js";

export const cronRouter = new Hono();

// Cron job: sync pending orders with Kryz-Net
cronRouter.all("/sync", async (c) => {
  console.log(`[CRON] /api/cron/sync triggered`);

  // Verify cron secret if configured
  const authHeader = c.req.header("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error(`[CRON] Unauthorized request`);
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = process.env.CRON_ADMIN_EMAIL;
  const password = process.env.CRON_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(`[CRON] CRON_ADMIN_EMAIL or CRON_ADMIN_PASSWORD not set.`);
    return c.json({ error: "Admin credentials not configured." }, 500);
  }

  try {
    const apiUrl = getKryzNetApiUrl();
    console.log(`[CRON] Authenticating admin...`);

    const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!loginRes.ok) {
      console.error(`[CRON] Admin login failed: ${loginRes.statusText}`);
      return c.json({ error: "Admin authentication failed" }, 401);
    }

    const loginData = (await loginRes.json()) as { token?: string };
    const jwtToken = loginData.token;

    if (!jwtToken) {
      return c.json({ error: "Token missing from login response" }, 500);
    }

    console.log(`[CRON] Authentication successful. Starting sync...`);

    // Fetch pending orders and sync with provider
    const apiKey = getKryzNetApiKey();
    const ordersRes = await fetch(`${apiUrl}/api/v1/admin/orders?status=pending`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        "x-api-key": apiKey,
      },
    });

    const ordersData = (await ordersRes.json()) as { data?: Array<{ id: string; status: string }> };
    const orders = ordersData?.data || [];

    let synced = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        const statusRes = await fetch(`${apiUrl}/api/v1/admin/orders/${order.id}/sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${jwtToken}`,
            "x-api-key": apiKey,
          },
        });
        if (statusRes.ok) synced++;
        else failed++;
      } catch {
        failed++;
      }
    }

    const result = { total: orders.length, synced, failed };
    console.log(`[CRON] Sync complete:`, result);
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CRON] Error during sync:`, message);
    return c.json({ error: "Internal Server Error", details: message }, 500);
  }
});
