import { Hono, type Context } from "hono";
import crypto from "crypto";
import { getSupabase } from "../lib/supabase.js";
import { getKryzNetApiUrl, getKryzNetApiKey, getBotSecret, getAdminSecret, fetchKryzNetV2 } from "../lib/kryznet.js";

export const botApiRouter = new Hono();

// --- HMAC Security & Admin Authentication Middleware ---
botApiRouter.use("*", async (c, next) => {
  const path = c.req.path;
  const botSecret = getBotSecret();
  const adminSecret = getAdminSecret();

  if (path.includes("/products") || path.includes("/auth") || path.includes("/cron")) {
    return next();
  }

  if (path.includes("/admin")) {
    const authHeader = c.req.header("authorization") || c.req.header("Authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    const token = bearerToken || c.req.header("x-admin-token") || c.req.header("X-Admin-Token");

    if (adminSecret && token === adminSecret) return next();
    if (token === botSecret) return next();

    const botId = c.req.header("x-bot-id") || c.req.header("X-Bot-ID");
    const timestamp = c.req.header("x-timestamp") || c.req.header("X-Timestamp");
    const signature = c.req.header("x-signature") || c.req.header("X-Signature");

    if (botId && timestamp && signature) {
      let reqTimeMs = parseInt(timestamp, 10);
      if (!isNaN(reqTimeMs)) {
        if (reqTimeMs < 10000000000) reqTimeMs *= 1000;
        if (Math.abs(Date.now() - reqTimeMs) <= 300 * 1000) {
          const expectedSig = crypto.createHmac("sha256", botSecret).update(`${botId}:${timestamp}`).digest("hex");
          const sigBuf = Buffer.from((signature || "").trim().toLowerCase(), "utf8");
          const expBuf = Buffer.from(expectedSig.toLowerCase(), "utf8");
          if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
            return next();
          }
        }
      }
    }

    return c.json({ error: "Unauthorized admin access" }, 401);
  }

  const botId = c.req.header("x-bot-id") || c.req.header("X-Bot-ID");
  const timestamp = c.req.header("x-timestamp") || c.req.header("X-Timestamp");
  const signature = c.req.header("x-signature") || c.req.header("X-Signature");

  if (!botId || !timestamp || !signature) {
    return c.json({ error: "Missing required HMAC authentication headers (X-Bot-ID, X-Timestamp, X-Signature)" }, 401);
  }

  let reqTimeMs = parseInt(timestamp, 10);
  if (isNaN(reqTimeMs)) return c.json({ error: "Invalid timestamp header" }, 401);
  if (reqTimeMs < 10000000000) reqTimeMs *= 1000;
  if (Math.abs(Date.now() - reqTimeMs) > 300 * 1000) {
    return c.json({ error: "Expired request timestamp" }, 401);
  }

  const expectedSignature = crypto.createHmac("sha256", botSecret).update(`${botId}:${timestamp}`).digest("hex");
  const sigBuf = Buffer.from((signature || "").trim().toLowerCase(), "utf8");
  const expBuf = Buffer.from(expectedSignature.toLowerCase(), "utf8");

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return c.json({ error: "Invalid bot request signature" }, 401);
  }

  return next();
});

// 1. GET /products
botApiRouter.get("/products", async (c) => {
  try {
    const data = await fetchKryzNetV2<any>("/games");
    const products = (data?.games || []).map((g: any) => ({
      id: g.slug,
      name: g.name,
      icon: g.icon || "",
      type: g.type || "game",
      fulfillment_type: g.fulfillment_type || "auto",
      input_schema: g.input_schema || null,
      description: g.description || "",
      total_services: g.total_services || 0,
    }));
    return c.json({ success: true, products });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[products] Failed:", message);
    return c.json({ success: false, error: message }, 500);
  }
});

// 2. Account Nickname Validation
const handleValidateAccount = async (c: Context) => {
  try {
    const body = await c.req.json().catch(() => ({} as Record<string, string>));
    const game_slug = body.game_slug || body.game_id || body.game || "";
    const player_id = body.player_id || body.user_id || body.account_id || body.game_user_id || "";
    const zone_id = body.zone_id || body.server_id || body.zone || "";

    if (!game_slug || !player_id) {
      return c.json({ success: false, nickname: null, error: "game_slug and player_id are required" }, 400);
    }

    try {
      const data = await fetchKryzNetV2<any>("/validate-account", {
        method: "POST",
        body: JSON.stringify({ game_slug, player_id, zone_id }),
      });
      return c.json({ success: true, nickname: data.nickname || "Player" });
    } catch {
      return c.json({ success: false, nickname: null, error: "Unable to validate account" }, 400);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, nickname: null, error: message }, 500);
  }
};

botApiRouter.post("/account/validate", handleValidateAccount);
botApiRouter.post("/v1/validate-account", handleValidateAccount);

// 3. POST /order/create (Atomic Balance Lock)
botApiRouter.post("/order/create", async (c) => {
  try {
    const supabase = getSupabase();
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const { user_id, telegram_id, product_id, player_id, zone_id, amount } = body as any;

    const orderAmount = parseFloat(amount || 0) || 10;
    const refId = `TX-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { data: rpcData, error: rpcErr } = await supabase.rpc("create_bot_order_atomic", {
      p_user_id: user_id || null,
      p_telegram_id: telegram_id ? parseInt(telegram_id, 10) : null,
      p_product_id: product_id || "",
      p_player_id: player_id || "",
      p_zone_id: zone_id || "",
      p_amount: orderAmount,
      p_reference_id: refId,
    });

    if (rpcErr || !rpcData || (rpcData as any).success === false) {
      const errorMsg = (rpcData as any)?.error || rpcErr?.message || "INSUFFICIENT_BALANCE";
      const message = (rpcData as any)?.message || rpcErr?.message || "Baki wallet anda tidak mencukupi.";
      return c.json({ success: false, error: errorMsg, message }, 400);
    }

    const idempotencyKey = crypto.randomUUID();
    let providerRes: any = null;
    let providerOrderId = "";

    try {
      providerRes = await fetchKryzNetV2<any>("/order", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ product_id: product_id || "srv-1", player_id: player_id || "12345678", server_id: zone_id || "" }),
      });
      providerOrderId = providerRes?.order_id || "";
    } catch (err: any) {
      // Refund local wallet on provider failure
      if (user_id) {
        try { await supabase.rpc("increment_balance", {
          p_user_id: user_id,
          p_amount: orderAmount,
          p_reason: `Refund: Provider failed ${refId}`,
        }); } catch {}
      }
      await supabase.from("transactions").update({ status: "Failed", updated_at: new Date().toISOString() }).eq("reference_id", refId);
      await supabase.from("provider_orders").update({ status: "Failed", updated_at: new Date().toISOString() }).eq("internal_transaction_id", refId);
      return c.json({ success: false, error: "PROVIDER_ERROR", message: err.message || "Provider order failed" }, 500);
    }

    await supabase
      .from("provider_orders")
      .update({ provider_order_id: providerOrderId, response_payload: providerRes, updated_at: new Date().toISOString() })
      .eq("internal_transaction_id", refId);

    if (providerOrderId) {
      await supabase.from("transactions").update({ status: "Processing", updated_at: new Date().toISOString() }).eq("reference_id", refId);
    }

    return c.json({
      success: true,
      reference_id: refId,
      provider_order_id: providerOrderId,
      status: providerOrderId ? "Processing" : "Failed",
      message: providerOrderId ? "Pesanan berjaya dihantar ke supplier." : "Pesanan gagal.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 4. GET /order/status/:id
botApiRouter.get("/order/status/:id", async (c) => {
  try {
    const supabase = getSupabase();
    const refId = c.req.param("id");

    const { data: tx, error: txErr } = await supabase.from("transactions").select("*").eq("reference_id", refId).maybeSingle();
    if (txErr || !tx) return c.json({ success: false, error: "Order not found" }, 404);

    const { data: pOrder } = await supabase.from("provider_orders").select("*").eq("internal_transaction_id", refId).maybeSingle();
    let currentStatus = (tx as any).status || "Processing";

    if ((pOrder as any)?.provider_order_id) {
      try {
        const statusData = await fetchKryzNetV2<any>(`/order/${(pOrder as any).provider_order_id}`);
        const v2Status = statusData?.status;
        if (v2Status) {
          const sl = (v2Status || "").toLowerCase();
          let newStatus = currentStatus;
          if (["sukses", "success", "delivered", "paid", "completed"].includes(sl)) newStatus = "Success";
          else if (["proses", "processing"].includes(sl)) newStatus = "Processing";
          else if (["gagal", "failed", "refund", "refunded", "cancelled", "error"].includes(sl)) newStatus = "Failed";
          else if (["pending", "menunggu"].includes(sl)) newStatus = "Pending";

          if (newStatus !== currentStatus) {
            currentStatus = newStatus;
            await supabase.from("transactions").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("reference_id", refId);
            await supabase.from("provider_orders").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("internal_transaction_id", refId);

            // Auto-refund on failure
            if (newStatus === "Failed" && (tx as any).user_id) {
              try { await supabase.rpc("increment_balance", {
                p_user_id: (tx as any).user_id,
                p_amount: parseFloat((tx as any).amount || 0),
                p_reason: `Refund: Order ${refId} failed`,
              }); } catch {}
            }
          }
        }
      } catch {}
    }

    return c.json({
      success: true,
      transaction: {
        reference_id: (tx as any).reference_id,
        product_id: (tx as any).product_id,
        amount: parseFloat((tx as any).amount || 0),
        status: currentStatus,
        provider_order_id: (pOrder as any)?.provider_order_id || null,
        created_at: (tx as any).created_at,
        updated_at: (tx as any).updated_at,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 5. GET /user/account/:telegram_id
botApiRouter.get("/user/account/:telegram_id", async (c) => {
  try {
    const telegramId = parseInt(c.req.param("telegram_id"), 10);
    if (isNaN(telegramId)) return c.json({ success: false, error: "Invalid telegram_id" }, 400);

    const supabase = getSupabase();
    const { data: userData, error: userErr } = await supabase.from("users").select("id, username, phone, telegram_verified_at").eq("telegram_id", telegramId).maybeSingle();
    if (userErr || !userData) return c.json({ success: false, error: "User not found" }, 404);

    const { data: walletData } = await supabase.from("wallets").select("balance_myr").eq("user_id", (userData as any).id).maybeSingle();
    const balance = walletData ? parseFloat((walletData as any).balance_myr || 0) : 0.0;

    return c.json({
      success: true,
      user: {
        telegram_id: telegramId,
        user_id: (userData as any).id,
        username: (userData as any).username,
        phone: (userData as any).phone,
        balance_myr: balance,
        verified: !!(userData as any).phone || !!(userData as any).telegram_verified_at,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 6. GET /user/history/:telegram_id
botApiRouter.get("/user/history/:telegram_id", async (c) => {
  try {
    const telegramId = parseInt(c.req.param("telegram_id"), 10);
    if (isNaN(telegramId)) return c.json({ success: false, error: "Invalid telegram_id" }, 400);

    const supabase = getSupabase();
    const { data: userData, error: userErr } = await supabase.from("users").select("id").eq("telegram_id", telegramId).maybeSingle();
    if (userErr || !userData) return c.json({ success: false, error: "User not found" }, 404);

    const { data: txList } = await supabase.from("transactions").select("*").eq("user_id", (userData as any).id).order("created_at", { ascending: false }).limit(10);

    return c.json({
      success: true,
      transactions: (txList || []).map((tx: any) => ({
        reference_id: tx.reference_id || tx.id,
        product_id: tx.product_id || "srv-1",
        player_id: tx.game_user_id || tx.player_id || "",
        zone_id: tx.zone_id || "",
        amount: parseFloat(tx.amount || 0),
        status: tx.status || "Completed",
        created_at: tx.created_at || new Date().toISOString(),
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 7. POST /auth/otp/send
botApiRouter.post("/auth/otp/send", async (c) => {
  try {
    const supabase = getSupabase();
    const { phone, purpose, user_id } = (await c.req.json().catch(() => ({}))) as any;
    if (!phone) return c.json({ success: false, error: "Phone number required" }, 400);

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 300 * 1000).toISOString();

    await supabase.from("otp").insert({ user_id: user_id || null, phone, otp_code: otpCode, purpose: purpose || "REGISTER", expiry, verified: false });
    console.log(`[OTP] Code sent to ${phone}`);

    return c.json({ success: true, message: "OTP sent", expires_in: 300 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 8. POST /auth/otp/verify
botApiRouter.post("/auth/otp/verify", async (c) => {
  try {
    const supabase = getSupabase();
    const { phone, otp_code, user_id } = (await c.req.json().catch(() => ({}))) as any;
    if (!phone || !otp_code) return c.json({ success: false, error: "Phone and OTP code required" }, 400);

    const nowIso = new Date().toISOString();
    const { data: otpRecords, error } = await supabase
      .from("otp").select("*").eq("phone", phone).eq("otp_code", otp_code).eq("verified", false).gte("expiry", nowIso).order("created_at", { ascending: false }).limit(1);

    if (error || !otpRecords || otpRecords.length === 0) {
      return c.json({ success: false, error: "Kod OTP tidak sah atau telah tamat tempoh." }, 400);
    }

    await supabase.from("otp").update({ verified: true }).eq("id", (otpRecords[0] as any).id);

    if (user_id || (otpRecords[0] as any).user_id) {
      const targetUserId = user_id || (otpRecords[0] as any).user_id;
      await supabase.from("users").update({ phone, telegram_verified_at: nowIso }).eq("id", targetUserId);
    }

    return c.json({ success: true, message: "Pengesahan berjaya!", user: { phone, verified: true } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 9. POST /admin/refund
botApiRouter.post("/admin/refund", async (c) => {
  try {
    const supabase = getSupabase();
    const { reference_id, reason } = (await c.req.json().catch(() => ({}))) as any;
    if (!reference_id) return c.json({ success: false, error: "reference_id required" }, 400);

    const { data: tx, error: txErr } = await supabase.from("transactions").select("*").eq("reference_id", reference_id).maybeSingle();
    if (txErr || !tx) return c.json({ success: false, error: `Transaction ${reference_id} not found` }, 404);
    if ((tx as any).status === "Refunded") return c.json({ success: false, error: "Transaction already refunded" }, 400);

    const refundAmount = parseFloat((tx as any).amount || 0);

    if ((tx as any).user_id) {
      const { data: wallet } = await supabase.from("wallets").select("*").eq("user_id", (tx as any).user_id).maybeSingle();
      if (wallet) {
        const newBalance = parseFloat((wallet as any).balance_myr || 0) + refundAmount;
        await supabase.from("wallets").update({ balance_myr: newBalance, updated_at: new Date().toISOString() }).eq("id", (wallet as any).id);
      }

      await supabase.from("wallet_transactions").insert({
        user_id: (tx as any).user_id, type: "credit", amount: refundAmount, currency: "MYR",
        reason: reason || `Refund for transaction ${reference_id}`, reference_id,
      });
    }

    await supabase.from("transactions").update({ status: "Refunded", updated_at: new Date().toISOString() }).eq("reference_id", reference_id);
    await supabase.from("provider_orders").update({ status: "Refunded", updated_at: new Date().toISOString() }).eq("internal_transaction_id", reference_id);

    return c.json({ success: true, message: `Refund RM ${refundAmount.toFixed(2)} for ${reference_id} completed.` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 10. GET /admin/provider/balance
botApiRouter.get("/admin/provider/balance", async (c) => {
  try {
    let balanceMyr = 0;
    try {
      const profile = await fetchKryzNetV2<any>("/profile");
      balanceMyr = profile.balance_myr || 0;
    } catch {}

    return c.json({ success: true, provider: "Kryz-Net", balance_myr: balanceMyr, is_low: balanceMyr < 50, alert: balanceMyr < 50 ? "LOW_BALANCE" : "OK" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// 11. POST /cron/products-sync
botApiRouter.post("/cron/products-sync", async (c) => {
  try {
    const supabase = getSupabase();
    let syncedCount = 0;

    const data = await fetchKryzNetV2<any>("/products").catch(() => null);
    if (data && data.products) {
      const productsToUpsert = data.products.map((p: any) => ({
        id: p.id || p.code || `prod-${Math.random().toString(36).substring(7)}`,
        name: p.name || "Game Product",
        code: p.code || "",
        brand: p.brand || "",
        provider_product_id: p.id || "",
        price_myr: parseFloat(p.price_myr || 10),
        price_idr: parseFloat(p.price_idr || 0),
        status: "active",
        updated_at: new Date().toISOString(),
      }));

      const { data: upsertData, error: upsertErr } = await supabase.from("products").upsert(productsToUpsert, { onConflict: "id" }).select();
      if (!upsertErr && upsertData) syncedCount = Array.isArray(upsertData) ? upsertData.length : productsToUpsert.length;
      else syncedCount = productsToUpsert.length;
    }

    return c.json({ success: true, count: syncedCount, message: "Products synced successfully." });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});