import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any, any, any> | null = null;

export function getSupabase() {
  if (_client) return _client;

  const supabaseUrl = process.env.SUPABASE_URL || "https://ldfodgqlwwxjggrhypmq.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseKey) {
    console.warn("[Supabase] SUPABASE_SERVICE_ROLE_KEY not set — using empty key");
  }

  _client = createClient<any, any, any>(supabaseUrl, supabaseKey);
  return _client;
}
