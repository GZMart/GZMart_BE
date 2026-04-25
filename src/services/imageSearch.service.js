/**
 * @fileoverview Phân tích ảnh sản phẩm: Groq vision (cùng pattern categoryImageSuggest) →
 * từ khóa song ngữ. Fallback: Gemini + CF (legacy) nếu Groq thất bại.
 */

import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GROQ_MODEL =
  process.env.GROQ_IMAGE_SEARCH_MODEL ||
  process.env.GROQ_CATEGORY_SUGGEST_MODEL ||
  "meta-llama/llama-4-scout-17b-16e-instruct";

const GEMINI_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
];

function trimArr(arr, max = 24) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((k) => typeof k === "string" && k.trim())
    .map((k) => k.trim())
    .slice(0, max);
}

const MAX_GARMENT_COLORS = 3;

/**
 * Chuỗi dùng cho UI / debug: đủ thông tin.
 */
function buildSearchTextFromBilingual({
  keywords_en,
  keywords_vi,
  caption_en,
  caption_vi,
  brand,
  garment_colors,
  product_type,
}) {
  const parts = [];
  if (product_type) parts.push(product_type);
  if (typeof brand === "string" && brand.trim()) parts.push(brand.trim());
  if (typeof caption_en === "string" && caption_en.trim()) parts.push(caption_en.trim());
  if (typeof caption_vi === "string" && caption_vi.trim()) parts.push(caption_vi.trim());
  if (Array.isArray(garment_colors)) {
    for (const c of garment_colors) {
      if (typeof c === "string" && c.trim()) parts.push(c.trim());
    }
  }
  for (const k of keywords_en || []) {
    if (k?.trim()) parts.push(k.trim());
  }
  for (const k of keywords_vi || []) {
    if (k?.trim()) parts.push(k.trim());
  }
  return parts.join(" | ").slice(0, 4000);
}

/**
 * Chuỗi gửi qua encoder embedding: ưu tiên loại sản phẩm + từ khóa, lặp phần cốt lõi;
 * màu (chỉ 1 lần, cuối) — tránh lệch sang nền / màu chung.
 */
function buildVectorQueryText({
  product_type,
  keywords_en = [],
  keywords_vi = [],
  caption_en = "",
  caption_vi = "",
  brand = "",
  garment_colors = [],
}) {
  const type = (product_type || "").trim();
  const capEn = (caption_en || "").trim();
  const capVi = (caption_vi || "").trim();
  const kEn = (keywords_en || []).map((k) => k.trim()).filter(Boolean);
  const kVi = (keywords_vi || []).map((k) => k.trim()).filter(Boolean);
  const br = (brand || "").trim();

  const corePieces = [type, capEn, capVi, br, ...kEn, ...kVi].filter(Boolean);
  const core = corePieces.join(" | ");
  if (!core) {
    return "";
  }
  // Lặp 2 lần phần type & keyword để vector nhấn mạnh category (vd: dress / váy)
  const doubled = [core, core].join(" || ");
  const gc = (garment_colors || [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_GARMENT_COLORS);
  const colorTail = gc.length ? ` | garment color: ${gc.join(", ")}` : "";
  return (doubled + colorTail).slice(0, 4000);
}

/**
 * Groq vision — cùng kiểu gọi với suggestCategoriesFromImageBuffer.
 */
const analyzeWithGroq = async (imageBuffer, mimeType) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) {
    throw new Error("GROQ_API_KEY is not set in environment variables.");
  }

  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const groq = new Groq({ apiKey });

  const visionPrompt = `You analyze the MAIN SELLABLE PRODUCT in the photo (e-commerce search, Vietnamese + English).
Return valid JSON only, shape:
{
  "product_type": "one English phrase: the single best product category e.g. silk dress, running shoes",
  "brand": "visible brand on the item or empty string",
  "keywords_en": ["5-18 short English terms: type first, then style, material, fit, audience. Put product type in the first 2 items."],
  "keywords_vi": ["5-18 short Vietnamese terms, same product; put product type in the first 2 (váy, giày, ...)"],
  "caption_en": "one line: what the product is, not the scene",
  "caption_vi": "one Vietnamese line: product only",
  "garment_colors": ["0 to 3 English color names of the GARMENT/FABRIC only (e.g. Silver, Champagne)"]
}
STRICT:
- List ONLY colors seen on the product/clothing. Do NOT name background, floor, wall, skin, or hair colors.
- If the dress is silver/gray, say Silver — do not add Black/Beige/Red from the backdrop.
- If unclear, use fewer colors or an empty array.
- keywords: emphasize item category (dress, bag, …) and material; avoid listing scene colors as keywords.
- No markdown, JSON only.`;

  const completion = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: visionPrompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.35,
    max_completion_tokens: 1024,
    top_p: 1,
    stream: false,
    response_format: { type: "json_object" },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq returned no content for image analysis.");
  }

  const parsed = JSON.parse(raw);
  const keywords_en = trimArr(parsed.keywords_en, 24);
  const keywords_vi = trimArr(parsed.keywords_vi, 24);
  const caption_en = typeof parsed.caption_en === "string" ? parsed.caption_en.trim() : "";
  const caption_vi = typeof parsed.caption_vi === "string" ? parsed.caption_vi.trim() : "";
  const brand =
    typeof parsed.brand === "string" && parsed.brand.trim() && parsed.brand !== "Unknown"
      ? parsed.brand.trim()
      : "";
  const product_type =
    typeof parsed.product_type === "string" && parsed.product_type.trim()
      ? parsed.product_type.trim()
      : "";
  const garment_colors = trimArr(
    Array.isArray(parsed.garment_colors) ? parsed.garment_colors : parsed.colors,
    MAX_GARMENT_COLORS,
  );

  const searchText = buildSearchTextFromBilingual({
    product_type,
    keywords_en,
    keywords_vi,
    caption_en,
    caption_vi,
    brand,
    garment_colors,
  });
  const vectorQueryText = buildVectorQueryText({
    product_type: product_type || keywords_en[0] || "",
    keywords_en,
    keywords_vi,
    caption_en,
    caption_vi,
    brand,
    garment_colors,
  });

  if (!searchText.trim() && !vectorQueryText.trim()) {
    throw new Error("Groq returned empty product description.");
  }

  const category = product_type || keywords_en[0] || keywords_vi[0] || "";
  return {
    provider: "groq",
    model: GROQ_MODEL,
    brand,
    product_type: product_type || null,
    keywords_en,
    keywords_vi,
    caption_en: caption_en || null,
    caption_vi: caption_vi || null,
    /** Màu trên sản phẩm (tối đa 3), dùng cho UI */
    colors: garment_colors,
    wardrobe_colors: garment_colors,
    /** Chuỗi hiển thị / tổng hợp */
    searchText: searchText || vectorQueryText,
    /** Ưu tiên dùng cho embedding — màu ít, type lặp */
    vectorQueryText: vectorQueryText || searchText,
    category,
    productName: category,
    material: "",
    features: [caption_en, caption_vi].filter(Boolean).join(" · "),
  };
};

const analyzeWithGemini = async (apiKey, imageBuffer, mimeType) => {
  const genAI = new GoogleGenerativeAI(apiKey);
  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const prompt = `Analyze this product image. Return ONLY valid JSON:
{"brand":"", "type":"product type in English", "color":"Black/White", "material":"", "features":"", "vi_keywords":["tiếng Việt 1","..."]}`;
      const imagePart = {
        inlineData: { data: imageBuffer.toString("base64"), mimeType },
      };
      const result = await model.generateContent([prompt, imagePart]);
      const text = result.response.text();
      const jsonString = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      return JSON.parse(jsonString);
    } catch (err) {
      console.warn(`[ImageSearch] Gemini ${modelName} failed:`, err.message?.slice(0, 80));
    }
  }
  return null;
};

const analyzeWithCFProxy = async (imageBuffer, mimeType) => {
  const proxyUrl = process.env.AI_API_URL;
  const token = process.env.AI_API_TOKEN;
  if (!proxyUrl || !token) {
    throw new Error("AI_API_URL or AI_API_TOKEN not configured for fallback.");
  }
  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Image}`;
  const prompt = `Analyze product image, return JSON only:
{"brand":"","type":"product type","color":"", "material":"", "features":""}
Image data URL start: ${dataUrl.slice(0, 200)}...`;
  const resp = await fetch(proxyUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!resp.ok) throw new Error(`CF Proxy error: ${resp.status}`);
  const data = await resp.json();
  const text = data.response || data.text || data.result || "";
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error("Could not parse CF proxy JSON");
  return JSON.parse(jsonMatch[0]);
};

/**
 * Map legacy Gemini/CF JSON → cùng shape với Groq (để search.service một đường xử lý).
 */
function legacyToAnalyzedInfo(parsed) {
  const type = (parsed.type || "").trim();
  const viKeywords = Array.isArray(parsed.vi_keywords)
    ? trimArr(
        parsed.vi_keywords.map((k) => String(k)),
        16,
      )
    : [];
  const enParts = [type, parsed.features, parsed.material]
    .filter(Boolean)
    .join(" ")
    .split(/[\s,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const colors = parsed.color
    ? String(parsed.color)
        .split(/[/,]/)
        .map((c) => c.trim())
        .filter(Boolean)
    : [];
  const keywords_en = [...new Set([type, ...enParts, ...colors].filter(Boolean))].slice(0, 20);
  const brand =
    parsed.brand && parsed.brand !== "Unknown" ? String(parsed.brand).trim() : "";
  const product_type = type || null;
  const garment_colors = colors.slice(0, MAX_GARMENT_COLORS);
  const searchText = buildSearchTextFromBilingual({
    product_type: type,
    keywords_en,
    keywords_vi: viKeywords.length ? viKeywords : keywords_en,
    caption_en: type,
    caption_vi: viKeywords[0] || "",
    brand,
    garment_colors,
  });
  const vectorQueryText = buildVectorQueryText({
    product_type: type,
    keywords_en,
    keywords_vi: viKeywords,
    caption_en: type,
    caption_vi: viKeywords[0] || "",
    brand,
    garment_colors,
  });
  return {
    provider: "gemini-cf",
    model: "legacy-vision",
    brand,
    product_type,
    keywords_en,
    keywords_vi: viKeywords.length ? viKeywords : [],
    caption_en: type || null,
    caption_vi: viKeywords[0] || null,
    colors: garment_colors,
    wardrobe_colors: garment_colors,
    searchText: searchText || type || "product",
    vectorQueryText: vectorQueryText || searchText || type,
    category: type,
    productName: type,
    material: parsed.material || "",
    features: parsed.features || "",
  };
}

export const imageSearchService = {
  analyzeProductImage: async (imageBuffer, mimeType) => {
    // 1) Groq (bilingual) — ưu tiên
    try {
      const out = await analyzeWithGroq(imageBuffer, mimeType);
      console.log("[ImageSearch] ✅ Groq vision:", out.model);
      return out;
    } catch (err) {
      console.warn("[ImageSearch] Groq analysis failed:", err.message);
    }

    // 2) Gemini
    const googleKey = process.env.GOOGLE_AI_API_KEY;
    let parsed = null;
    if (googleKey) {
      try {
        parsed = await analyzeWithGemini(googleKey, imageBuffer, mimeType);
      } catch (e) {
        console.warn("[ImageSearch] Gemini error:", e.message);
      }
    }

    // 3) CF proxy
    if (!parsed) {
      try {
        parsed = await analyzeWithCFProxy(imageBuffer, mimeType);
      } catch (e) {
        console.warn("[ImageSearch] CF proxy error:", e.message);
      }
    }

    if (!parsed) {
      throw new Error(
        "Image analysis failed: set GROQ_API_KEY, or GOOGLE_AI_API_KEY / AI proxy for fallback.",
      );
    }

    return legacyToAnalyzedInfo(parsed);
  },
};

export default imageSearchService;
