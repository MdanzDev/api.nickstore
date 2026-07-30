export const getKryzNetApiUrl = () =>
  process.env.EXTERNAL_API_URL || "https://api.kryz-net.space";

export const getKryzNetApiKey = () =>
  process.env.EXTERNAL_API_KEY || "kryz_live_9879cc6429efeb4ee638528c344a60b144bde4c5";

export const getBotSecret = () =>
  process.env.BOT_SECRET || "nickstore_secret_bot_key_2026";
