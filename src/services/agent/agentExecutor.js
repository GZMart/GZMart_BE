import { classifyIntent, extractParams } from "./intentRouter.js";
import { getTool } from "./tools.js";
import { sanitizePromptInput } from "../../utils/promptSanitizer.js";
import { detectPrimaryLocale } from "../../utils/replyLocale.js";

// Import all tools to trigger registerTool() calls
import "./tools/productSearch.js";
import "./tools/outfitBundle.js";
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

function buildRoleGreeting(role, locale = "vi") {
  const en = locale === "en";
  if (role === "seller") {
    return en
      ? "Hello! I'm GZMart's AI assistant for sellers. I can help you with:\n" +
        "📊 Revenue and sales trend analysis\n" +
        "📦 Stock checks and low-stock alerts\n" +
        "📈 Demand forecasting and restock reminders\n" +
        "📋 Orders that need attention\n" +
        "⭐ Product review summaries\n" +
        "🔄 Return and exchange requests\n\n" +
        "What do you need help with?"
      : "Xin chào! Tôi là trợ lý AI của GZMart dành cho người bán. Tôi có thể giúp bạn:\n" +
        "📊 Phân tích doanh thu và xu hướng bán hàng\n" +
        "📦 Kiểm tra tồn kho và cảnh báo hết hàng\n" +
        "📈 Dự báo nhu cầu và cảnh báo nhập hàng\n" +
        "📋 Xem đơn hàng cần xử lý\n" +
        "⭐ Tổng hợp đánh giá sản phẩm\n" +
        "🔄 Theo dõi yêu cầu đổi/trả\n\n" +
        "Bạn cần hỗ trợ gì?";
  }
  if (role === "admin") {
    return en
      ? "Hello Admin! I'm GZMart's analytics assistant. I can help you with:\n" +
        "📊 System overview (revenue, orders, users)\n" +
        "📈 User growth analysis\n" +
        "🏷️ Revenue by category\n" +
        "🏆 Seller performance\n" +
        "🔍 Product search\n\n" +
        "What would you like to see?"
      : "Xin chào Admin! Tôi là trợ lý phân tích GZMart. Tôi có thể giúp bạn:\n" +
        "📊 Tổng quan hệ thống (revenue, orders, users)\n" +
        "📈 Phân tích tăng trưởng người dùng\n" +
        "🏷️ Doanh thu theo danh mục\n" +
        "🏆 Hiệu suất người bán\n" +
        "🔍 Tìm kiếm sản phẩm\n\n" +
        "Bạn cần xem gì?";
  }
  return en
    ? "Hello! I'm GZMart's shopping assistant 😊 I can help you with:\n" +
      "🔍 Product search\n" +
      "🔥 Deals, flash sales, vouchers\n" +
      "📦 Order lookup\n" +
      "⭐ Product reviews\n\n" +
      "What are you looking for today?"
    : "Xin chào! Tôi là trợ lý mua sắm GZMart 😊 Tôi có thể giúp bạn:\n" +
      "🔍 Tìm kiếm sản phẩm\n" +
      "🔥 Xem deal, flash sale, voucher\n" +
      "📦 Tra cứu đơn hàng\n" +
      "⭐ Xem đánh giá sản phẩm\n\n" +
      "Bạn cần tìm gì hôm nay?";
}

function buildSystemPrompt(role, toolResults, locale = "vi") {
  const en = locale === "en";
  const roleLabel = {
    buyer: en ? "GZMart shopping assistant" : "trợ lý mua sắm GZMart",
    seller: en ? "analytics assistant for GZMart sellers" : "trợ lý phân tích dành cho Seller GZMart",
    admin: en ? "analytics assistant for GZMart admins" : "trợ lý phân tích dành cho Admin GZMart",
  };

  const combinedContext = toolResults
    .map((r) => r.context)
    .filter(Boolean)
    .join("\n\n");

  let prompt = en
    ? `You are the ${roleLabel[role] || roleLabel.buyer}. Reply in English, friendly and professional.

The data below is from GZMart. It is the ONLY source — do NOT invent facts.

${combinedContext}

=== HOW TO REPLY ===`
    : `Bạn là ${roleLabel[role] || roleLabel.buyer}. Trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp.

DỮ LIỆU BÊN DƯỚI là kết quả từ hệ thống GZMart. ĐÂY LÀ NGUỒN DUY NHẤT — TUYỆT ĐỐI KHÔNG bịa thông tin.

${combinedContext}

=== CÁCH TRẢ LỜI ===`;

  if (role === "buyer") {
    prompt += en
      ? `
1. Only suggest products that appear in the search results above.
2. Each product MUST include a [[product:ID]] tag on its own line. Use the ID from [ID:...] in the data.
3. Do NOT repeat name, price, or rating — the UI shows cards. Write one short sentence about a highlight.
4. If there are deals/vouchers, mention briefly.
5. If nothing was found, say so clearly.
6. If the block is an OUTFIT SET, group by type (top, pants, shoes...) and each item still needs [[product:ID]].
7. Do not answer off-topic (weather, news, homework, politics...). If the user goes off shopping, decline briefly and invite them to ask about GZMart products.
8. Only attach [[product:ID]] for products that have [ID:...] in the data; do not invent products or swap items.
9. If the user asked for men's or women's items: only discuss items in the data (already filtered); do not add products from memory.`
      : `
1. CHỈ gợi ý sản phẩm CÓ TRONG kết quả tìm kiếm ở trên.
2. Mỗi sản phẩm PHẢI kèm tag [[product:ID]] trên dòng riêng. ID lấy từ [ID:...] trong dữ liệu.
3. KHÔNG viết lại tên, giá, rating — hệ thống tự hiển thị card. Chỉ viết 1 câu về điểm nổi bật.
4. Nếu có deal/voucher, nhắc ngắn gọn.
5. Nếu không tìm thấy, nói thẳng.
6. Nếu dữ liệu là "GỢI Ý SET ĐỒ", nhóm gợi ý theo từng loại (áo, quần, giày...) và mỗi sản phẩm vẫn cần [[product:ID]].
7. Không trả lời kiến thức ngoài GZMart (thời tiết, tin tức, bài tập, chính trị...). Nếu người dùng hỏi lệch chủ đề mua sắm, từ chối ngắn và mời họ hỏi về sản phẩm trên GZMart.
8. CHỈ gắn [[product:ID]] với sản phẩm có [ID:...] trong khối dữ liệu; không bịa SP, không thay quần/áo/giày bằng túi/ví/nhẫn nếu không có đúng dòng sản phẩm đó trong dữ liệu.
9. Nếu user nói rõ nam hay nữ: chỉ bàn luận các món đã có trong khối dữ liệu (hệ thống đã lọc); không tự thêm sản phẩm ngoài danh sách dù model “đoán” được.`;
  } else if (role === "seller") {
    prompt += en
      ? `
1. Present numbers clearly; use emoji for readability.
2. Give observations and improvement ideas from real data.
3. Compare with the previous period if data allows.
4. Call out issues (out-of-stock, bad reviews, pending orders).
5. Be concise and direct.`
      : `
1. Trình bày số liệu rõ ràng, dùng emoji để dễ đọc.
2. Đưa ra nhận xét và gợi ý cải thiện dựa trên dữ liệu thực tế.
3. So sánh với kỳ trước nếu có dữ liệu.
4. Nêu bật vấn đề cần chú ý (SP hết hàng, review xấu, đơn chờ xử lý).
5. Ngắn gọn, đi thẳng vào vấn đề.`;
  } else if (role === "admin") {
    prompt += en
      ? `
1. Summarize platform-wide data with insights.
2. Compare trends; highlight anomalies.
3. Suggest action items from the data.
4. Format numbers clearly with emoji.`
      : `
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
  const locale = detectPrimaryLocale(safeMessage.sanitized);

  if (isGreeting) return { text: buildRoleGreeting(role, locale), products: [] };

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

  const systemPrompt = buildSystemPrompt(role, toolResults, locale);

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
