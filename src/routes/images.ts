import { Hono } from "hono";
import { getKryzNetApiUrl, getKryzNetApiKey } from "../lib/kryznet.js";

export const imagesRouter = new Hono();

// Image proxy — serve game images from Kryz-Net through same origin
imagesRouter.get("/:filename", async (c) => {
  const filename = c.req.param("filename");
  const apiUrl = getKryzNetApiUrl();
  const apiKey = getKryzNetApiKey();

  try {
    const response = await fetch(`${apiUrl}/img/${filename}`, {
      headers: { "x-api-key": apiKey },
    });

    if (!response.ok) return c.notFound();

    const contentType = response.headers.get("content-type") || "image/png";
    const buffer = await response.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return c.notFound();
  }
});
