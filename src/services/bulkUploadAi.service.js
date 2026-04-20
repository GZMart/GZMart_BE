import Category from "../models/Category.js";
import embeddingService from "./embedding.service.js";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.72;
const EMBED_BATCH = 20;

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

function productToEmbedText(p) {
  const parts = [
    p.name,
    p.description,
    p.brand,
    Array.isArray(p.tags) ? p.tags.join(" ") : null,
  ].filter(Boolean);
  return parts.join(" | ").slice(0, 4000);
}

/**
 * Preview: gợi ý danh mục bằng embedding (batch). File không chứa danh mục.
 * @param {object[]} products
 */
export async function buildBulkPreviewItems(products) {
  const threshold = Number(
    process.env.BULK_UPLOAD_AI_CONFIDENCE_THRESHOLD || DEFAULT_CONFIDENCE_THRESHOLD,
  );

  const categories = await Category.find({ status: "active" })
    .select("name slug")
    .lean();

  let categoryEmbeddings = null;
  if (categories.length > 0) {
    try {
      const catTexts = categories.map((c) =>
        `${c.name || ""} | ${c.slug || ""}`.trim(),
      );
      categoryEmbeddings = await embeddingService.getEmbeddings(catTexts);
    } catch {
      categoryEmbeddings = null;
    }
  }

  const needAiIndices = products.map((_, i) => i);

  const textsForAi = needAiIndices.map((i) => productToEmbedText(products[i]));
  const productEmbeddings = [];

  if (textsForAi.length > 0 && categoryEmbeddings) {
    for (let s = 0; s < textsForAi.length; s += EMBED_BATCH) {
      const chunk = textsForAi.slice(s, s + EMBED_BATCH);
      const embs = await embeddingService.getEmbeddings(chunk);
      productEmbeddings.push(...embs);
    }
  }

  const embByProductIndex = new Map();
  needAiIndices.forEach((idx, j) => {
    embByProductIndex.set(idx, productEmbeddings[j]);
  });

  const items = [];

  for (let index = 0; index < products.length; index++) {
    const product = { ...products[index] };

    const ai = {
      suggestedCategoryId: null,
      suggestedCategoryName: null,
      suggestedSlug: null,
      confidence: null,
      needsReview: true,
      skipped: false,
      embeddingFailed: false,
    };

    if (categories.length > 0) {
      const pEmb = embByProductIndex.get(index);
      if (pEmb && categoryEmbeddings) {
        let bestIdx = 0;
        let bestSim = -2;
        for (let k = 0; k < categoryEmbeddings.length; k++) {
          const sim = cosineSimilarity(pEmb, categoryEmbeddings[k]);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = k;
          }
        }
        const confidence = Math.max(0, Math.min(1, (bestSim + 1) / 2));
        const cat = categories[bestIdx];
        ai.suggestedCategoryId = String(cat._id);
        ai.suggestedCategoryName = cat.name;
        ai.suggestedSlug = cat.slug;
        ai.confidence = Math.round(confidence * 1000) / 1000;
        ai.needsReview = confidence < threshold;
      } else {
        ai.embeddingFailed = true;
      }
    }

    const defaultCategoryId = ai.suggestedCategoryId || null;

    items.push({
      index,
      product,
      ai,
      defaultCategoryId,
      confidenceThreshold: threshold,
    });
  }

  return {
    items,
    categoriesMeta: { count: categories.length, embeddingOk: Boolean(categoryEmbeddings) },
  };
}
