import { Hono } from "hono";
import { getSupabase } from "../lib/supabase.js";
import { fetchKryzNetV2 } from "../lib/kryznet.js";

export const cronRouter = new Hono();

cronRouter.all("/sync", async (c) => {
  console.log(`[CRON] /api/cron/sync triggered`);

  const authHeader = c.req.header("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error(`[CRON] Unauthorized request`);
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const supabase = getSupabase();
    let synced = 0;
    let depositsCredited = 0;

    // Sweep pending deposits
    const { data: pendingDeps } = await supabase.from("deposits").select("*").eq("status", "Pending").eq("credited", false).limit(50);
    if (pendingDeps && pendingDeps.length > 0) {
      for (const dep of pendingDeps) {
        try {
          const data = await fetchKryzNetV2<any>(`/deposit/${dep.kryznet_deposit_id}`);
          if (data.status === "Success") {
            if (dep.user_id) {
              try { await supabase.rpc("increment_balance", {
                p_user_id: dep.user_id,
                p_amount: parseFloat(dep.amount_myr || 0),
                p_reason: `Deposit ${dep.kryznet_deposit_id} paid`,
              }); } catch {}
            }
            await supabase.from("deposits").update({ status: "Success", credited: true, updated_at: new Date().toISOString() }).eq("id", dep.id);
            depositsCredited++;
          } else if (data.status === "Expired" || data.status === "Failed") {
            await supabase.from("deposits").update({ status: data.status === "Expired" ? "Expired" : "Failed", updated_at: new Date().toISOString() }).eq("id", dep.id);
          }
        } catch (e: any) {
          console.error(`[CRON] Deposit sweep failed for ${dep.kryznet_deposit_id}:`, e.message);
        }
      }
    }

    // Sync order statuses
    const { data: pendingOrders } = await supabase.from("transactions").select("*").in("status", ["Pending", "Processing"]).order("created_at", { ascending: false }).limit(100);

    if (pendingOrders) {
      for (const order of pendingOrders) {
        const orderId = order.reference_id;
        if (!orderId || orderId.startsWith("PG-") || orderId.startsWith("DEPO")) continue;

        try {
          const data = await fetchKryzNetV2<any>(`/order/${orderId}`);
          const v2Status = data.status;
          const sl = (v2Status || "").toLowerCase();

          let newStatus = order.status;
          if (["sukses", "success", "delivered", "paid", "completed"].includes(sl)) newStatus = "Success";
          else if (["proses", "processing"].includes(sl)) newStatus = "Processing";
          else if (["gagal", "failed", "refund", "refunded", "cancelled", "error"].includes(sl)) newStatus = "Failed";
          else if (["pending", "menunggu"].includes(sl)) newStatus = "Pending";

          if (newStatus !== order.status) {
            if (newStatus === "Failed" && order.user_id) {
              try { await supabase.rpc("increment_balance", {
                p_user_id: order.user_id,
                p_amount: parseFloat(order.amount || 0),
                p_reason: `Refund: Order ${orderId} failed`,
              }); } catch {}
            }
            await supabase.from("transactions").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", order.id);
            synced++;
          }
        } catch (e: any) {
          console.error(`[CRON] Status sync failed for ${orderId}:`, e.message);
        }
      }
    }

    const result = { synced, depositsCredited };
    console.log(`[CRON] Sync complete:`, result);
    return c.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[CRON] Error during sync:`, message);
    return c.json({ error: "Internal Server Error", details: message }, 500);
  }
});