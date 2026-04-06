/**
 * AI Insight Service — demand analysis text generation via LLM
 *
 * Architecture:
 *   1. Rule-based algorithms (scraping, scoring) compute precise metrics
 *   2. These metrics are sent as structured data to LLM via HTTP
 *   3. LLM generates a natural-language insight paragraph
 *
 * This hybrid approach gives you:
 *   - Accurate numbers (from algorithmic computation)
 *   - Natural, intelligent prose (from LLM)
 *
 * Uses the same AI_API_URL / AI_API_TOKEN pattern as the agent tools
 * (via @GZMart_BE/src/services/agent/tools.js)
 */

import { sanitizePromptInput } from "../utils/promptSanitizer.js";

// ── AI API configuration (same as agentExecutor / priceSuggestion) ───────────
const AI_API_URL = process.env.AI_API_URL || "https://textgeneration.trongducdoan25.workers.dev/";
const AI_API_TOKEN = process.env.AI_API_TOKEN;

// ── In-memory cache for AI-generated insights ─────────────────────────────────
/**
 * Key: `${productId}_${trendDays}_${suggestedQty}`
 * Value: { text, generatedAt }
 */
const insightCache = new Map();
const INSIGHT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function makeInsightCacheKey(productId, trendDays, suggestedQty) {
  return `${productId}_${trendDays}_${suggestedQty}`;
}

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of insightCache.entries()) {
    if (now - entry.generatedAt > INSIGHT_CACHE_TTL_MS) {
      insightCache.delete(key);
    }
  }
}

// Run cleanup every 10 minutes
setInterval(cleanExpiredCache, 10 * 60 * 1000);

// ── Prompt builder ─────────────────────────────────────────────────────────────

function buildInsightPrompt({
  productName,
  totalStock,
  avgDailyQty,
  totalSold,
  leadTimeDays,
  daysUntilStockout,
  suggestedQty,
  estimatedRevenue,
  trendPct,
  webTrends,
  days,
  shopeeScore,
  tikiScore,
  marketPriceLow,
  marketPriceHigh,
  currentPrice,
}) {
  const fmt = (n) =>
    n ? n.toLocaleString("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }) : "N/A";

  const trendLabel =
    trendPct >= 15
      ? "strongly trending upward"
      : trendPct >= 5
      ? "growing"
      : trendPct >= -5
      ? "relatively stable"
      : trendPct >= -15
      ? "slightly declining"
      : "declining significantly";

  const webTrendDesc = (() => {
    if (!webTrends?.hasData) return "No external market data available yet.";
    const maxScore = Math.max(shopeeScore || 0, tikiScore || 0);
    if (maxScore >= 70) return `Strong market presence detected (score: ${maxScore}/100).`;
    if (maxScore >= 40) return `Moderate market interest (score: ${maxScore}/100).`;
    return `Low market visibility (score: ${maxScore}/100).`;
  })();

  const priceAnalysis = (() => {
    if (!marketPriceLow || !currentPrice) return null;
    const ratio = currentPrice / marketPriceLow;
    if (ratio < 0.85) return "Your price is significantly below competitors — potential to increase margins.";
    if (ratio < 1.0) return "Your price is competitive, slightly below market average.";
    if (ratio <= 1.1) return "Your price is aligned with market range.";
    if (ratio <= 1.3) return "Your price is above market average — consider whether premium positioning is justified.";
    return "Your price is notably higher than competitors — this may impact competitiveness.";
  })();

  return `You are a smart inventory advisor for Vietnamese e-commerce sellers on GZMart.

Generate a concise, professional demand insight paragraph (80–140 words) in English for the seller.

PRODUCT: ${productName}
ANALYSIS PERIOD: ${days} days

=== RAW METRICS (do NOT invent these numbers) ===
- Sales trend: ${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}% compared to prior period (${trendLabel})
- Current stock: ${totalStock} units
- Avg daily sales: ${avgDailyQty.toFixed(1)} units/day
- Total sold in period: ${totalSold} units
- Days until stockout (if sales continue): ${daysUntilStockout !== null ? daysUntilStockout + " days" : "cannot estimate (no sales)"}
- Supplier lead time: ${leadTimeDays !== null ? leadTimeDays + " days" : "no data available"}
- Recommended order qty: ${suggestedQty} units
- Estimated revenue from suggested order: ${estimatedRevenue ? fmt(estimatedRevenue) : "N/A"}
- Market trend score: ${webTrends?.hasData ? (shopeeScore || 0) + "/100 (Shopee) | " + (tikiScore || 0) + "/100 (Tiki)" : "No data"}
- Market trend: ${webTrendDesc}
- Market price range: ${marketPriceLow ? fmt(marketPriceLow) + " – " + fmt(marketPriceHigh) : "No data"}
${priceAnalysis ? `- Price analysis: ${priceAnalysis}` : ""}
${suggestedQty > 0 && daysUntilStockout !== null && leadTimeDays !== null && daysUntilStockout <= leadTimeDays ? `\n⚠️ IMPORTANT: Stockout risk is BEFORE lead time expires — order immediately!` : ""}

=== OUTPUT RULES ===
- Write 1 paragraph of 80–140 words
- Start with a strong opening observation about the trend or urgency
- Naturally weave in the key numbers from the metrics above
- If stockout is imminent (<=7 days) AND lead time is long, emphasise the risk explicitly
- If product is trending up AND has market validation, mention both together
- If product is stable/declining, focus on efficiency and avoiding overstock
- End with a clear, actionable recommendation
- Use bullet points ONLY if there are 2+ urgent action items
- Do NOT fabricate any numbers — only use the metrics provided above
- Language: English, professional tone, semi-formal`;
}

const SYSTEM_PROMPT = `You are a smart inventory advisor for Vietnamese e-commerce sellers on GZMart.
You generate concise, data-driven demand insight paragraphs in English.
NEVER invent or estimate numbers — only use data provided in the prompt.
Keep output to 1 paragraph (80–140 words).`;

// ── LLM call (same pattern as agentExecutor / priceSuggestion) ─────────────────

async function callLLM(prompt) {
  const safePrompt = sanitizePromptInput(prompt);
  if (safePrompt.blocked) {
    console.warn("[AI Insight] prompt injection blocked:", safePrompt.sanitized);
  }

  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: safePrompt.sanitized, systemPrompt: SYSTEM_PROMPT, history: [] }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const raw = await res.text();
  try {
    const json = JSON.parse(raw);
    return json.response || raw;
  } catch {
    return raw;
  }
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Generate a natural-language demand insight for a single product.
 *
 * Falls back to a structured text paragraph if:
 *   - AI_API_URL / AI_API_TOKEN not configured
 *   - API call fails
 *   - Model returns empty/invalid response
 *
 * @param {Object} params - Computed metrics from demandForecast.service.js
 * @returns {Promise<string>} - The aiInsight text
 */
export async function generateDemandInsight(params) {
  const {
    productId,
    productName,
    totalStock,
    avgDailyQty,
    totalSold,
    leadTimeDays,
    daysUntilStockout,
    suggestedQty,
    estimatedRevenue,
    trendPct,
    webTrends,
    days,
    marketPrices,
    currentPrice,
  } = params;

  // ── Cache lookup ──────────────────────────────────────���────────────
  const cacheKey = makeInsightCacheKey(productId, days, suggestedQty);
  const cached = insightCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAt < INSIGHT_CACHE_TTL_MS) {
    return cached.text;
  }

  // ── Build structured prompt ───────────────────────────────────────
  let shopeeScore = null;
  let tikiScore = null;
  if (webTrends?.trendSources?.length) {
    for (const src of webTrends.trendSources) {
      if (src.platform === "Shopee") shopeeScore = src.score;
      if (src.platform === "Tiki") tikiScore = src.score;
    }
  }

  const marketPriceLow = marketPrices?.low || null;
  const marketPriceHigh = marketPrices?.high || null;

  const prompt = buildInsightPrompt({
    productName,
    totalStock,
    avgDailyQty,
    totalSold,
    leadTimeDays,
    daysUntilStockout,
    suggestedQty,
    estimatedRevenue,
    trendPct,
    webTrends,
    days,
    shopeeScore,
    tikiScore,
    marketPriceLow,
    marketPriceHigh,
    currentPrice,
  });

  // ── Call LLM ───────────────────────────────────────────────────────
  if (!AI_API_URL || !AI_API_TOKEN) {
    console.warn("[AI Insight] AI_API_URL / AI_API_TOKEN not configured — using fallback text");
    return buildFallbackInsight(params);
  }

  try {
    const text = (await callLLM(prompt)).trim();

    if (!text || text.length < 30) {
      console.warn("[AI Insight] LLM returned empty/short response — using fallback");
      return buildFallbackInsight(params);
    }

    // Cache successful response
    insightCache.set(cacheKey, { text, generatedAt: Date.now() });

    return text;
  } catch (err) {
    console.error("[AI Insight] LLM call error:", err.message);
    return buildFallbackInsight(params);
  }
}

// ── Fallback text (replaces old template-string concatenation) ─────────────────

function buildFallbackInsight(params) {
  const {
    productName,
    totalStock,
    avgDailyQty,
    totalSold,
    leadTimeDays,
    daysUntilStockout,
    suggestedQty,
    estimatedRevenue,
    trendPct,
    webTrends,
    days,
    marketPrices,
    currentPrice,
  } = params;

  const fmt = (n) =>
    n ? n.toLocaleString("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }) : "—";

  const trendLabel =
    trendPct >= 15
      ? "is trending strongly upward"
      : trendPct >= 5
      ? "is showing growth momentum"
      : trendPct >= -5
      ? "is holding relatively steady"
      : trendPct >= -15
      ? "is showing a slight decline"
      : "is experiencing a significant downward trend";

  const webInsight = webTrends?.hasData
    ? `This product has a market trend score of ${webTrends.globalTrendScore}/100 on external platforms.`
    : "No external market data is available for this product yet.";

  const stockoutWarning = (() => {
    if (daysUntilStockout === null) return "";
    if (daysUntilStockout <= 7 && leadTimeDays !== null && daysUntilStockout <= leadTimeDays)
      return `CRITICAL: At the current pace, stock runs out in ${daysUntilStockout} days — but your supplier lead time is ${leadTimeDays} days. Place the order immediately!`;
    if (daysUntilStockout <= 7)
      return `⚠️ Warning: Stock will run out in approximately ${daysUntilStockout} days. Order immediately.`;
    if (daysUntilStockout <= 14)
      return `Stockout expected in about ${daysUntilStockout} days — plan to restock soon.`;
    return `Current stock covers approximately ${daysUntilStockout} days at the current sales rate.`;
  })();

  const priceHint = (() => {
    if (!marketPrices?.low || !currentPrice) return null;
    if (currentPrice < marketPrices.low)
      return "Your price is below competitors — competitive advantage.";
    if (currentPrice > marketPrices.high)
      return "Your price is above competitors — consider adjusting.";
    return "Your price is within the competitive market range.";
  })();

  const recommendation =
    suggestedQty > 0
      ? `Recommend ordering approximately ${suggestedQty} units${
          estimatedRevenue ? ` (est. revenue: ${fmt(estimatedRevenue)})` : ""
        } to maintain stable supply.`
      : "Stock level appears adequate for the current demand forecast.";

  const parts = [
    `Analysis of **${productName}** ${trendLabel} over the past ${days} days (${trendPct >= 0 ? "sales up" : "sales down"} ${Math.abs(trendPct.toFixed(1))}% vs prior period).`,
    "",
    `Current inventory: **${totalStock} units** (avg ${avgDailyQty.toFixed(1)}/day | ${totalSold} total sold).`,
    stockoutWarning ? `**Stock Status:** ${stockoutWarning}` : "",
    `**Market:** ${webInsight}`,
    priceHint ? `**Pricing:** ${priceHint}` : "",
    `**Recommendation:** ${recommendation}`,
  ].filter(Boolean);

  return parts.join("\n");
}