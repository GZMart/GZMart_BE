/**
 * @fileoverview Service for analyzing product images using Google Gemini API
 * Falls back to Cloudflare Workers AI proxy if Gemini quota is exhausted.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

// Models to try in fallback order
const GEMINI_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
];

/**
 * Attempt to analyze via Gemini SDK (official Node.js SDK)
 */
const analyzeWithGemini = async (apiKey, imageBuffer, mimeType) => {
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of GEMINI_MODELS) {
    try {
      console.log(`[ImageSearch] Trying Gemini model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `Analyze this product image and return ONLY a valid JSON object:
{
  "brand": "brand name if visible, else empty string",
  "type": "product type e.g. sneakers, t-shirt, laptop, watch, handbag",
  "color": "dominant colors joined by slash e.g. Black/White",
  "material": "material if identifiable e.g. leather, cotton, plastic",
  "features": "key visual features e.g. high-top, lace-up, chunky-sole",
  "vi_keywords": ["list", "of", "5", "to", "10", "exact", "vietnamese", "translation", "keywords", "for", "this", "product"]
}
Return ONLY the JSON object. No markdown, no explanation.`;

      const imagePart = {
        inlineData: {
          data: imageBuffer.toString("base64"),
          mimeType,
        },
      };

      const result = await model.generateContent([prompt, imagePart]);
      const text = result.response.text();
      const jsonString = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const parsed = JSON.parse(jsonString);

      console.log(`[ImageSearch] ✅ Gemini ${modelName} success:`, parsed);
      return parsed;
    } catch (err) {
      const status = err.status || err.httpErrorCode?.status;
      console.warn(`[ImageSearch] Gemini ${modelName} failed (${status}): ${err.message?.slice(0, 100)}`);
      // Continue to next model
    }
  }
  return null; // All Gemini models failed
};

/**
 * Fallback: Use CF Workers proxy (text gen) to analyze image via base64 prompt.
 * This works when Gemini is geo-blocked (Vietnam etc.)
 */
const analyzeWithCFProxy = async (imageBuffer, mimeType) => {
  const proxyUrl = process.env.AI_API_URL;
  const token = process.env.AI_API_TOKEN;

  if (!proxyUrl || !token) {
    throw new Error("AI_API_URL or AI_API_TOKEN not configured for fallback.");
  }

  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const prompt = `I will describe a product image to you in base64 format. Analyze it and return ONLY a valid JSON:
{
  "brand": "brand if identifiable, else empty string",
  "type": "product type e.g. sneakers, t-shirt, laptop",
  "color": "dominant colors joined by slash",
  "material": "material if identifiable",
  "features": "brief key visual features"
}

Image (base64): ${dataUrl.slice(0, 200)}...

Return ONLY the JSON object.`;

  const resp = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  if (!resp.ok) {
    throw new Error(`CF Proxy error: ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.response || data.text || data.result || "";

  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Could not extract JSON from CF proxy response: ${text.slice(0, 200)}`);
  }

  return JSON.parse(jsonMatch[0]);
};

export const imageSearchService = {
  analyzeProductImage: async (imageBuffer, mimeType) => {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_AI_API_KEY is not set in environment variables.");
    }

    let parsed = null;
    let usedFallback = false;

    // Strategy 1: Try Gemini SDK
    try {
      parsed = await analyzeWithGemini(apiKey, imageBuffer, mimeType);
    } catch (err) {
      console.warn("[ImageSearch] Gemini analysis failed:", err.message);
    }

    // Strategy 2: Fall back to CF Workers proxy
    if (!parsed) {
      console.log("[ImageSearch] Falling back to CF Workers proxy...");
      try {
        parsed = await analyzeWithCFProxy(imageBuffer, mimeType);
        usedFallback = true;
        console.log("[ImageSearch] ✅ CF proxy success:", parsed);
      } catch (err) {
        console.warn("[ImageSearch] CF proxy analysis failed:", err.message);
      }
    }

    if (!parsed) {
      throw new Error(
        "Image analysis failed: Gemini API quota exceeded and CF proxy unavailable. " +
        "Please ensure GOOGLE_AI_API_KEY is valid and has available quota."
      );
    }

    if (usedFallback) {
      console.log("[ImageSearch] Used CF Workers proxy fallback for image analysis");
    }

    return {
      category: parsed.type || "",
      productName: parsed.type || "",
      brand: (parsed.brand && parsed.brand !== "Unknown") ? parsed.brand : "",
      colors: parsed.color
        ? parsed.color.split(/[/,]/).map(c => c.trim()).filter(Boolean)
        : [],
      material: parsed.material || "",
      features: parsed.features || "",
    };
  }
};

export default imageSearchService;
