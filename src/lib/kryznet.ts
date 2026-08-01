export const getKryzNetApiUrl = () =>
  process.env.EXTERNAL_API_URL || "https://api.kryz-net.space";

export const getKryzNetApiKey = () =>
  process.env.EXTERNAL_API_KEY || "kryz_live_aedfce4fe13c90efaa32c5f05aecb07e8b20bb30b5da03d48b1bbf0afe1eb3e6";

export const getBotSecret = () =>
  process.env.BOT_SECRET || "nickstore_secret_bot_key_2026";

export const getAdminSecret = () =>
  process.env.ADMIN_SECRET || "admin_secret_key_2026";

export async function fetchKryzNetV2<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getKryzNetApiKey();
  if (!apiKey) throw new Error("EXTERNAL_API_KEY not configured");
  const url = `${getKryzNetApiUrl()}${endpoint.startsWith("/api/v2") ? endpoint : `/api/v2${endpoint}`}`;
  const headers = new Headers(options.headers || {});
  headers.set("X-API-KEY", apiKey);
  headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => null) as any;
    const msg = err?.error?.message || err?.error || `Kryz-Net API error (${res.status})`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}