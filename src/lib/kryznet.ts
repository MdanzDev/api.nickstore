export const getKryzNetApiUrl = () =>
  process.env.EXTERNAL_API_URL || "https://api.kryz-net.space";

export const getKryzNetApiKey = () =>
  process.env.EXTERNAL_API_KEY || "kryz_live_c20fabc004eed526bd2b924ee38ab3c861f3ff32";

export const getBotSecret = () =>
  process.env.BOT_SECRET || "nickstore_secret_bot_key_2026";
