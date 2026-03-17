import express from "express";
import aiService from "../services/ai.service.js";

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
        message,
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

export default router;
