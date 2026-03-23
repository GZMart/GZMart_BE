import express from "express";
import mongoose from "mongoose";
import aiService from "../services/ai.service.js";
import {
  executePriceSuggestion,
  prepareBatchPriceSuggestion,
  finalizeBatchPriceSuggestion,
} from "../services/agent/tools/priceSuggestion.js";
import PriceSuggestRateLimit from "../models/PriceSuggestRateLimit.js";
import { sanitizePromptInput, sanitizeProductName } from "../utils/promptSanitizer.js";
import multiStrategyCache from "../services/multiStrategyCache.service.js";

const router = express.Router();


function simulateStream(res, fullText, conversationId, chunkSize = 12) {
  return new Promise((resolve) => {
    let index = 0;
    const send = () => {
      if (index < fullText.length) {
        const end = Math.min(index + chunkSize, fullText.length);
        const chunk = fullText.slice(index, end);
        res.write(
          JSON.stringify({
            type: "message",
            content: chunk,
            conversationId: conversationId || null,
          }) + "\n",
        );
        index = end;
        setTimeout(send, 15);
      } else {
        resolve();
      }
    };
    send();
  });
}

router.post("/stream", async (req, res) => {
  let conversationId = null;

  try {
    const {
      message,
      conversationId: cId,
      conversationHistory,
      role = "buyer",
      userId,
      sellerId,
    } = req.body || {};
    conversationId = cId;

    if (!message) {
      return res
        .status(400)
        .json({ message: "Missing required field: message" });
    }

    // [Safety] Strip prompt-injection patterns from user message
    const safeMessage = sanitizePromptInput(message);
    if (safeMessage.blocked) {
      console.warn(`[AI stream] message injection blocked: "${message}" → "${safeMessage.sanitized}"`);
    }

    const validRoles = ["buyer", "seller", "admin"];
    const safeRole = validRoles.includes(role) ? role : "buyer";

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setTimeout(120000);

    const validHistory = Array.isArray(conversationHistory)
      ? conversationHistory
          .filter((m) => m.role && m.content)
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content).slice(0, 2000),
          }))
          .slice(-20)
      : [];

    res.write(
      JSON.stringify({
        type: "thinking",
        content: "AI đang xử lý...",
        conversationId: conversationId || null,
      }) + "\n",
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(
          JSON.stringify({
            type: "heartbeat",
            conversationId: conversationId || null,
          }) + "\n",
        );
      } catch {
        clearInterval(heartbeat);
      }
    }, 5000);

    let fullText;
    try {
      fullText = await aiService.chat({
        message: safeMessage.sanitized,
        conversationHistory: validHistory,
        role: safeRole,
        userId,
        sellerId,
      });
    } finally {
      clearInterval(heartbeat);
    }

    if (safeRole === "buyer") {
      fullText = aiService.injectMissingProductTags(fullText);
    }

    await simulateStream(res, fullText, conversationId);

    const productIds = safeRole === "buyer" ? aiService.extractProductIds(fullText) : [];
    let products = [];
    if (productIds.length > 0) {
      try {
        products = await aiService.getProductCards(productIds);
      } catch (err) {
        console.error("Error fetching product cards:", err);
      }
    }

    res.write(
      JSON.stringify({
        type: "final",
        content: {
          final_response: fullText,
          conversation_id: conversationId || null,
          products,
        },
      }) + "\n",
    );

    res.end();
  } catch (error) {
    console.error("AI Chat Error:", error);

    const isRateLimit =
      error.message?.includes("429") ||
      error.message?.includes("rate_limit");

    const fallback = `Xin chào! Tôi là AI tư vấn của GZMart. Hiện tại kết nối đến hệ thống AI đang gián đoạn (Lỗi: ${isRateLimit ? "Quá tải hệ thống" : "Kết nối"}), nhưng tôi có thể giúp bạn:\n1. Tìm kiếm sản phẩm\n2. Liên hệ người bán\n3. Xem chính sách đổi trả\n\nBạn cần hỗ trợ cụ thể về vấn đề gì ạ?`;

    if (res.headersSent) {
      res.write(
        JSON.stringify({
          type: "error",
          content: fallback,
          conversationId: conversationId || null,
        }) + "\n",
      );
      res.end();
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    await simulateStream(res, fallback, conversationId, 50);

    res.write(
      JSON.stringify({
        type: "final",
        content: {
          final_response: fallback,
          conversation_id: conversationId || null,
        },
      }) + "\n",
    );
    res.end();
  }
});

router.post("/refresh-cache", async (req, res) => {
  try {
    aiService.invalidateCache();
    const kb = await aiService.buildKnowledgeBase();
    res.json({
      success: true,
      message: "Knowledge base cache refreshed",
      size: `${(kb.length / 1024).toFixed(1)} KB`,
    });
  } catch (error) {
    console.error("Cache refresh error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});


/**
 * POST /api/ai/price-suggest
 * Dedicated endpoint for the 🪄 AI Suggest button on the seller product listing.
 * Returns structured JSON (not streamed) with a suggested price and market data.
 *
 * Body: { productId?, productName?, sellerId, modelId?, strategy? }
 * [Phase 3 - 5.1] strategy parameter added for Pricing Personas.
 */
router.post("/price-suggest", async (req, res) => {
  try {
    // [Phase 2 - 4.1] modelId added for variant-aware price suggestion
    // [Phase 3 - 5.1] strategy added for Pricing Personas
    const { productId, productName, sellerId, modelId, strategy = "balanced" } = req.body || {};

    // [Safety] Strip prompt-injection patterns from seller-controlled productName
    const safeProductName = sanitizeProductName(productName || "");
    if (safeProductName.blocked) {
      console.warn(`[AI price-suggest] productName injection blocked: "${productName}" → "${safeProductName.sanitized}"`);
    }

    if (!sellerId) {
      return res.status(400).json({ success: false, message: "Missing sellerId" });
    }

    // [Phase 1 - 3.3] Rate Limiting: 50 requests/day per seller, 30s cooldown per product
    try {
      let rateLimit = await PriceSuggestRateLimit.findOne({
        sellerId: new mongoose.Types.ObjectId(sellerId),
      });

      if (rateLimit) {
        const check = rateLimit.checkAndIncrement(productId);
        if (!check.allowed) {
          return res.json({
            success: false,
            message: check.message,
            rateLimit: check.reason,
          });
        }
        await rateLimit.save();
      } else {
        // First request — create record
        const newLimit = new PriceSuggestRateLimit({
          sellerId: new mongoose.Types.ObjectId(sellerId),
        });
        const check = newLimit.checkAndIncrement(productId);
        if (!check.allowed) {
          return res.json({
            success: false,
            message: check.message,
            rateLimit: check.reason,
          });
        }
        await newLimit.save();
      }
    } catch (err) {
      // DB issue — allow through, do not block user
      console.error("[rateLimit] Error:", err.message);
    }

    // [Phase 2 - 4.1] Pass modelId so execute() can resolve the correct variant price
    // [Phase 3 - 5.1] Pass strategy for Pricing Personas
    // [Safety] Pass sanitized productName — query is sanitized again inside askLLM()
    const result = await executePriceSuggestion({ sellerId, productId, query: safeProductName.sanitized, modelId, strategy });

    if (!result.suggestedPrice) {
      // Tool returned a context-only result (e.g., no products found)
      return res.json({
        success: false,
        message: result.context || "Không thể đề xuất giá.",
      });
    }

    return res.json({
      success: true,
      suggestedPrice: result.suggestedPrice,
      reasoning: result.reasoning,
      warning: result.warning || null,
      riskLevel: result.riskLevel || "safe",
      warningMessage: result.warningMessage || null,
      discountPct: result.discountPct || null,
      // [Phase 3 - 5.1] Strategy metadata
      strategy: result.strategy || strategy,
      marketData: result.marketData,
      competitors: result.competitors || [],
      product: result.product,
      // [Phase 2 - 4.2] Cache metadata for frontend UX indicators
      fromCache: result.fromCache || false,
      cachedAt: result.cachedAt || null,
      // [Multi-strategy Redis cache] Include all strategies for instant switching
      allStrategies: result.allStrategies || null,
    });
  } catch (error) {
    console.error("[AI price-suggest] Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});


/**
 * POST /api/ai/price-suggest-batch
 * Batch price suggestion for all variants of a product.
 * Returns structured JSON with per-variant suggestions + shared market data.
 *
 * Body: { productId?, productName?, sellerId, modelIds: string[], strategy? }
 * [Phase 3 - 5.1] strategy parameter added for Pricing Personas.
 */
router.post("/price-suggest-batch", async (req, res) => {
  try {
    const { productId, productName, sellerId, modelIds, strategy = "balanced" } = req.body || {};

    // [Safety] Strip prompt-injection patterns from seller-controlled productName
    const safeProductName = sanitizeProductName(productName || "");
    if (safeProductName.blocked) {
      console.warn(`[AI price-suggest-batch] productName injection blocked: "${productName}" → "${safeProductName.sanitized}"`);
    }

    if (!sellerId) {
      return res.status(400).json({ success: false, message: "Missing sellerId" });
    }
    if (!modelIds || !Array.isArray(modelIds) || !modelIds.length) {
      return res.status(400).json({ success: false, message: "Missing or invalid modelIds array" });
    }

    // Phase 1: vector search + batch cache (no LLM). Cache hit → skip rate limit & 30s cooldown.
    // [Phase 3 - 5.1] Pass strategy for Pricing Personas
    const prep = await prepareBatchPriceSuggestion({ sellerId, productId, modelIds, strategy });

    if (prep.context) {
      return res.json({
        success: false,
        message: prep.context,
      });
    }

    if (prep.success && prep.fromCache) {
      return res.json({
        success: true,
        fromCache: true,
        cachedAt: prep.cachedAt || null,
        results: prep.results,
        product: prep.product,
        marketData: prep.marketData,
        competitors: prep.competitors || [],
        // [Phase 3 - 5.1]
        strategy: prep.strategy || strategy,
      });
    }

    // Phase 2: rate limit only when we will call LLM (cache miss)
    try {
      let rateLimit = await PriceSuggestRateLimit.findOne({
        sellerId: new mongoose.Types.ObjectId(sellerId),
      });

      if (rateLimit) {
        const check = rateLimit.checkAndIncrement(productId);
        if (!check.allowed) {
          return res.json({
            success: false,
            message: check.message,
            rateLimit: check.reason,
          });
        }
        await rateLimit.save();
      } else {
        const newLimit = new PriceSuggestRateLimit({ sellerId: new mongoose.Types.ObjectId(sellerId) });
        const check = newLimit.checkAndIncrement(productId);
        if (!check.allowed) {
          return res.json({ success: false, message: check.message, rateLimit: check.reason });
        }
        await newLimit.save();
      }
    } catch (err) {
      console.error("[rateLimit] Error:", err.message);
    }

    const result = await finalizeBatchPriceSuggestion(prep.precompute);

    if (!result.success || !result.results?.length) {
      return res.json({
        success: false,
        message: "Không thể đề xuất giá cho các biến thể này.",
      });
    }

    return res.json({
      success: true,
      fromCache: false,
      results: result.results,
      product: result.product,
      marketData: result.marketData,
      competitors: result.competitors || [],
      // [Phase 3 - 5.1]
      strategy: result.strategy || strategy,
    });
  } catch (error) {
    console.error("[AI price-suggest-batch] Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Clear all Redis price-suggestion cache
router.post("/price-suggest-cache/clear", async (req, res) => {
  try {
    const result = await multiStrategyCache.clearAllCache();
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[AI price-suggest-cache/clear] Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;

