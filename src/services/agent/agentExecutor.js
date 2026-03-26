import { classifyIntent, extractParams } from "./intentRouter.js";
import { getTool } from "./tools.js";
import { sanitizePromptInput } from "../../utils/promptSanitizer.js";

// Import all tools to trigger registerTool() calls
import "./tools/productSearch.js";
import "./tools/dealVoucherInfo.js";
import "./tools/categoryBrowse.js";
import "./tools/reviewAnalysis.js";
import "./tools/orderLookup.js";
import "./tools/salesAnalytics.js";
import "./tools/inventoryCheck.js";
import "./tools/shopOrders.js";
import "./tools/shopReviews.js";
import "./tools/returnRequests.js";
import "./tools/platformStats.js";
import "./tools/userGrowth.js";
import "./tools/categorySales.js";
import "./tools/sellerPerformance.js";
import "./tools/priceSuggestion.js";

const AI_API_URL = process.env.AI_API_URL || "https://textgeneration.trongducdoan25.workers.dev/";
const AI_API_TOKEN = process.env.AI_API_TOKEN;

function buildRoleGreeting(role) {
  if (role === "seller") {
    return "Xin chào! Tôi là trợ lý AI của GZMart dành cho người bán. Tôi có thể giúp bạn:\n" +
      "📊 Phân tích doanh thu và xu hướng bán hàng\n" +
      "📦 Kiểm tra tồn kho và cảnh báo hết hàng\n" +
      "📈 Dự báo nhu cầu và cảnh báo nhập hàng\n" +
      "📋 Xem đơn hàng cần xử lý\n" +
      "⭐ Tổng hợp đánh giá sản phẩm\n" +
      "🔄 Theo dõi yêu cầu đổi/trả\n\n" +
      "Bạn cần hỗ trợ gì?";
  }
  if (role === "admin") {
    return "Xin chào Admin! Tôi là trợ lý phân tích GZMart. Tôi có thể giúp bạn:\n" +
      "📊 Tổng quan hệ thống (revenue, orders, users)\n" +
      "📈 Phân tích tăng trưởng người dùng\n" +
      "🏷️ Doanh thu theo danh mục\n" +
      "🏆 Hiệu suất người bán\n" +
      "🔍 Tìm kiếm sản phẩm\n\n" +
      "Bạn cần xem gì?";
  }
  return "Xin chào! Tôi là trợ lý mua sắm GZMart 😊 Tôi có thể giúp bạn:\n" +
    "🔍 Tìm kiếm sản phẩm\n" +
    "🔥 Xem deal, flash sale, voucher\n" +
    "📦 Tra cứu đơn hàng\n" +
    "⭐ Xem đánh giá sản phẩm\n\n" +
    "Bạn cần tìm gì hôm nay?";
}

function buildSystemPrompt(role, toolResults) {
  const roleLabel = {
    buyer: "trợ lý mua sắm GZMart",
    seller: "trợ lý phân tích dành cho Seller GZMart",
    admin: "trợ lý phân tích dành cho Admin GZMart",
  };

  const combinedContext = toolResults
    .map((r) => r.context)
    .filter(Boolean)
    .join("\n\n");

  let prompt = `Bạn là ${roleLabel[role] || roleLabel.buyer}. Trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp.

DỮ LIỆU BÊN DƯỚI là kết quả từ hệ thống GZMart. ĐÂY LÀ NGUỒN DUY NHẤT — TUYỆT ĐỐI KHÔNG bịa thông tin.

${combinedContext}

=== CÁCH TRẢ LỜI ===`;

  if (role === "buyer") {
    prompt += `
1. CHỈ gợi ý sản phẩm CÓ TRONG kết quả tìm kiếm ở trên.
2. Mỗi sản phẩm PHẢI kèm tag [[product:ID]] trên dòng riêng. ID lấy từ [ID:...] trong dữ liệu.
3. KHÔNG viết lại tên, giá, rating — hệ thống tự hiển thị card. Chỉ viết 1 câu về điểm nổi bật.
4. Nếu có deal/voucher, nhắc ngắn gọn.
5. Nếu không tìm thấy, nói thẳng.`;
  } else if (role === "seller") {
    prompt += `
1. Trình bày số liệu rõ ràng, dùng emoji để dễ đọc.
2. Đưa ra nhận xét và gợi ý cải thiện dựa trên dữ liệu thực tế.
3. So sánh với kỳ trước nếu có dữ liệu.
4. Nêu bật vấn đề cần chú ý (SP hết hàng, review xấu, đơn chờ xử lý).
5. Ngắn gọn, đi thẳng vào vấn đề.`;
  } else if (role === "admin") {
    prompt += `
1. Tổng hợp dữ liệu platform-wide, đưa ra insights.
2. So sánh trends, highlight anomalies.
3. Đề xuất action items dựa trên dữ liệu.
4. Format số liệu rõ ràng với emoji.`;
  }

  return prompt;
}

async function executeAgent({ message, role = "buyer", userId, sellerId, conversationHistory = [] }) {
  // [Safety] Strip prompt-injection patterns from user message
  const safeMessage = sanitizePromptInput(message);
  if (safeMessage.blocked) {
    console.warn(`[Agent] message injection blocked: "${message}" → "${safeMessage.sanitized}"`);
  }

  // [Safety] Strip injection from conversation history (prevents multi-turn poisoning)
  const safeHistory = (conversationHistory || []).map((m) => ({
    ...m,
    content: sanitizePromptInput(m.content || "").sanitized,
  }));

  const { tools: toolNames, isGreeting } = classifyIntent(safeMessage.sanitized, role);

  if (isGreeting) return { text: buildRoleGreeting(role), products: [] };

  const baseParams = extractParams(safeMessage.sanitized, role, userId, sellerId);

  const toolResults = await Promise.all(
    toolNames.map(async (name) => {
      const tool = getTool(name);
      if (!tool) return { context: "" };
      try {
        const params = { ...baseParams, query: safeMessage.sanitized };
        return await tool.execute(params);
      } catch (err) {
        console.error(`[Agent] Tool ${name} failed:`, err.message);
        return { context: `Tool ${name} gặp lỗi.` };
      }
    })
  );

  const systemPrompt = buildSystemPrompt(role, toolResults);

  const history = safeHistory.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));

  const res = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AI_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt: safeMessage.sanitized, systemPrompt, history }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`AI API error ${res.status}: ${errText}`);
  }

  const raw = await res.text();
  let text;
  try {
    const json = JSON.parse(raw);
    text = json.response || raw;
  } catch {
    text = raw;
  }

  const allProducts = toolResults.flatMap((r) => r.products || []);

  return { text, products: allProducts, toolsUsed: toolNames };
}

export { executeAgent, buildRoleGreeting };
