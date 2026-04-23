import Groq from "groq-sdk";
import Category from "../models/Category.js";
import embeddingService from "./embedding.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";

const DEFAULT_MODEL =
  process.env.GROQ_CATEGORY_SUGGEST_MODEL ||
  "meta-llama/llama-4-scout-17b-16e-instruct";

const DEFAULT_TOP_K = Math.min(
  15,
  Math.max(1, parseInt(process.env.CATEGORY_IMAGE_SUGGEST_TOP_K || "5", 10) || 5),
);

const DEFAULT_CONFIDENCE_THRESHOLD = 0.72;

/** 0–1: kết hợp điểm vector với trùng chữ từ keyword trên text category (giảm nhiễu kiểu “trang sức” với “đầm”). */
const LEXICAL_WEIGHT = (() => {
  const raw = Number(process.env.CATEGORY_IMAGE_LEXICAL_WEIGHT);
  const v = Number.isFinite(raw) ? raw : 0.38;
  return Math.min(1, Math.max(0, v));
})();

/** Nhân điểm confidence khi từ khóa là đồ người nhưng category trông như đồ thú cưng (vd: Cat Clothing & Sweaters). */
const PET_CONFLICT_FACTOR = (() => {
  const raw = Number(process.env.CATEGORY_IMAGE_PET_CONFLICT_FACTOR);
  const v = Number.isFinite(raw) ? raw : 0.22;
  return Math.min(1, Math.max(0.05, v));
})();

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) {
    return -1;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? -1 : dot / denom;
}

function keywordsToSearchText(keywords, caption) {
  const parts = [];
  if (typeof caption === "string" && caption.trim()) {
    parts.push(caption.trim());
  }
  if (Array.isArray(keywords)) {
    for (const k of keywords) {
      if (typeof k === "string" && k.trim()) parts.push(k.trim());
    }
  }
  return parts.join(" | ").slice(0, 4000);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Từ tiếng Anh / số: khớp theo ranh giới từ để tránh nhiễu (trừ khi cả cụm khớp). */
function pieceMatchesInHay(piece, hayLower) {
  const p = String(piece || "")
    .toLowerCase()
    .trim();
  if (p.length < 2) {
    return false;
  }
  const asciiToken = /^[a-z0-9'-]+$/i.test(p);
  if (asciiToken && p.length >= 3) {
    const re = new RegExp(`\\b${escapeRegExp(p)}s?\\b`, "i");
    return re.test(hayLower);
  }
  if (asciiToken && p.length === 2) {
    return new RegExp(`\\b${escapeRegExp(p)}\\b`, "i").test(hayLower);
  }
  return hayLower.includes(p);
}

/**
 * Từ khóa có vẻ mô tả thời trang / đồ mặc cho người (không phải thú cưng).
 */
function keywordsSuggestHumanApparel(keywords, caption) {
  const blob = [...(keywords || []), caption || ""].join(" ").toLowerCase();
  const petish = /\b(cat|dog|pet|pets|kitten|puppy|meow|paw|mèo|chó|thú\s*cưng)\b/.test(
    blob,
  );
  const vnPeople =
    /(nữ|nam|women|men|phụ\s*nữ|áo\s*len|quần\s*áo|váy|đầm|sơ\s*mi|thời\s*trang|mùa\s*đông|phong\s*cách)/.test(
      blob,
    );
  const enPeople = /\b(women|womens|men|mens|ladies|unisex)\b/.test(blob);
  if (vnPeople || enPeople) {
    return true;
  }
  const outerwear =
    /\b(sweater|cardigan|hoodie|blazer|jacket|coat|shirt|turtleneck|pullover)\b/.test(
      blob,
    );
  if (outerwear && !petish) {
    return true;
  }
  return false;
}

/**
 * Danh mục trông như đồ / phụ kiện cho thú cưng.
 */
function categoryLooksPetRelated(fullText) {
  const s = (fullText || "").toLowerCase();
  if (/\b(thú\s*cưng|đồ\s*mèo|đồ\s*chó|quần\s*áo\s*mèo)\b/.test(s)) {
    return true;
  }
  if (/\b(cat|dog)\s+clothing\b/.test(s)) {
    return true;
  }
  if (/\b(cat|dog)\s+(sweater|sweaters|coat|shirt|hoodie|costume|jumper|apparel)\b/.test(s)) {
    return true;
  }
  if (/\bpet\s+(clothing|apparel|costume|sweater|coat)\b/.test(s)) {
    return true;
  }
  if (/\b(kitten|puppy)\s+/.test(s)) {
    return true;
  }
  if (/(^|[\s|/])(cat|dog|pet|pets)-(clothing|sweater|coat|apparel)\b/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Đếm keyword khớp text category (breadcrumb + name + slug + mô tả).
 */
function lexicalKeywordHits(keywords, categorySearchText) {
  const hay = (categorySearchText || "").toLowerCase();
  if (!hay || !keywords.length) {
    return 0;
  }
  const seen = new Set();
  for (const k of keywords) {
    const t = String(k || "")
      .toLowerCase()
      .trim();
    if (t.length < 2) {
      continue;
    }
    if (hay.includes(t)) {
      seen.add(t);
      continue;
    }
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const allPieces = words.every((w) => pieceMatchesInHay(w, hay));
      if (allPieces) {
        seen.add(t);
        continue;
      }
    }
    const first = words[0];
    if (first && words.length > 1 && pieceMatchesInHay(first, hay)) {
      seen.add(first);
    }
  }
  return seen.size;
}

function buildCategoryByIdMap(categories) {
  return new Map(categories.map((c) => [String(c._id), c]));
}

function categoryBreadcrumb(cat, byId) {
  const parts = [];
  let cur = cat;
  let guard = 0;
  while (cur && guard++ < 6) {
    parts.unshift((cur.name || "").trim());
    const pid = cur.parentId ? String(cur.parentId) : null;
    cur = pid ? byId.get(pid) : null;
  }
  return parts.filter(Boolean).join(" > ");
}

/** Text dùng cho embedding + lexical: đủ ngữ cảnh cây danh mục. */
function categoryEmbedText(cat, byId) {
  const trail = categoryBreadcrumb(cat, byId);
  const desc = (cat.description || "").trim();
  const chunks = [trail, cat.name, cat.slug, desc].filter(Boolean);
  return chunks.join(" | ").slice(0, 2000);
}

/**
 * B1: Groq vision → keywords + caption (JSON).
 * B2: Embedding chuỗi tìm kiếm + cosine similarity với embedding từng category (giống bulk upload).
 * @param {{ buffer: Buffer, mimeType: string }} params
 */
export async function suggestCategoriesFromImageBuffer({ buffer, mimeType }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) {
    throw new ErrorResponse("Chưa cấu hình GROQ_API_KEY trên server.", 503);
  }

  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  const groq = new Groq({ apiKey });

  const visionPrompt = `You analyze a product photo for e-commerce search (Vietnamese/English catalog).
Return valid JSON only, shape:
{"keywords":["short term 1","term 2",...],"caption":"one short phrase describing the product"}
Rules:
- keywords: 5 to 18 items, each a short noun phrase or head term (product type, gender/audience, material, style, use case). Good for semantic / vector search.
- No long sentences inside keywords; no duplicate meanings.
- caption: single concise line (optional but preferred).
- Language: Vietnamese and/or English as appropriate for the product.`;

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visionPrompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.4,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: false,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    const msg =
      err?.message || err?.error?.message || "Lỗi khi gọi Groq API.";
    throw new ErrorResponse(msg, 502);
  }

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new ErrorResponse("Groq không trả về nội dung.", 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ErrorResponse("Không đọc được JSON từ AI.", 502);
  }

  const keywords = Array.isArray(parsed.keywords)
    ? parsed.keywords
        .filter((k) => typeof k === "string" && k.trim())
        .map((k) => k.trim())
        .slice(0, 24)
    : [];

  const caption =
    typeof parsed.caption === "string" ? parsed.caption.trim() : "";

  const searchText = keywordsToSearchText(keywords, caption);

  const categories = await Category.find({ status: "active" })
    .select("_id name slug parentId level description")
    .lean();

  const categoryById = buildCategoryByIdMap(categories);

  const threshold = Number(
    process.env.BULK_UPLOAD_AI_CONFIDENCE_THRESHOLD ||
      DEFAULT_CONFIDENCE_THRESHOLD,
  );

  const result = {
    keywords,
    caption: caption || null,
    searchText,
    model: DEFAULT_MODEL,
    suggestions: [],
    embeddingOk: false,
    confidenceThreshold: threshold,
    categoriesMeta: { count: categories.length },
  };

  if (!searchText.trim() || categories.length === 0) {
    return result;
  }

  let queryEmbedding;
  try {
    queryEmbedding = await embeddingService.getEmbedding(searchText);
  } catch {
    return result;
  }

  let categoryEmbeddings;
  const catTextsForLexical = categories.map((c) =>
    categoryEmbedText(c, categoryById),
  );

  try {
    categoryEmbeddings = await embeddingService.getEmbeddings(catTextsForLexical);
  } catch {
    return result;
  }

  result.embeddingOk = true;

  const humanApparel = keywordsSuggestHumanApparel(keywords, caption);

  const scored = categories.map((cat, idx) => {
    const sim = cosineSimilarity(queryEmbedding, categoryEmbeddings[idx]);
    const simNorm = Math.max(0, Math.min(1, (sim + 1) / 2));
    const catText = catTextsForLexical[idx];
    const hitCount = lexicalKeywordHits(keywords, catText);
    const lexNorm = Math.min(1, hitCount / Math.max(4, keywords.length * 0.5));
    let blended =
      simNorm * (1 - LEXICAL_WEIGHT) + lexNorm * LEXICAL_WEIGHT;
    if (humanApparel && categoryLooksPetRelated(catText)) {
      blended *= PET_CONFLICT_FACTOR;
    }
    const confidence = Math.round(blended * 1000) / 1000;
    return {
      categoryId: String(cat._id),
      name: cat.name,
      slug: cat.slug,
      level: cat.level,
      parentId: cat.parentId ? String(cat.parentId) : null,
      similarity: Math.round(sim * 10000) / 10000,
      /** Điểm hiển thị sau khi trộn vector + trùng từ khóa (và phạt xung đột pet/people). */
      confidence,
      keywordHits: hitCount,
      petConflictDownrank: Boolean(
        humanApparel && categoryLooksPetRelated(catText),
      ),
      needsReview: confidence < threshold,
    };
  });

  scored.sort((a, b) => b.confidence - a.confidence);
  result.suggestions = scored.slice(0, DEFAULT_TOP_K);

  return result;
}
