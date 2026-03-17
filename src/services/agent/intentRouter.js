import { getToolsForRole } from "./tools.js";

const ROLE_GREETING_KEYWORDS = {
  buyer: ["chào", "hello", "hi", "xin chào", "hey", "alo"],
  seller: ["chào", "hello", "hi", "xin chào"],
  admin: ["chào", "hello", "hi", "xin chào"],
};

const ROLE_DEFAULT_TOOLS = {
  buyer: ["productSearch"],
  seller: ["salesAnalytics"],
  admin: ["platformStats"],
};

function classifyIntent(message, role = "buyer") {
  const lower = message.toLowerCase().trim();
  const availableTools = getToolsForRole(role);

  const greetings = ROLE_GREETING_KEYWORDS[role] || [];
  if (greetings.some((g) => lower === g || lower === g + " ạ" || lower === g + " nhé")) {
    return { tools: [], isGreeting: true };
  }

  const scored = availableTools.map((tool) => {
    const matchCount = tool.keywords.filter((kw) => lower.includes(kw)).length;
    return { name: tool.name, score: matchCount };
  });

  const matched = scored
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matched.length === 0) {
    return { tools: ROLE_DEFAULT_TOOLS[role] || ["productSearch"], isDefault: true };
  }

  const selectedTools = matched
    .slice(0, 3)
    .map((t) => t.name);

  return { tools: selectedTools };
}

function extractParams(message, role, userId, sellerId) {
  const params = {};

  const numbers = message.match(/\d+/g);
  if (numbers) {
    const num = parseInt(numbers[0]);
    if (num > 0 && num <= 365) params.days = num;
    if (num > 0 && num <= 100) params.limit = num;
  }

  if (/tuần|week/i.test(message)) params.period = "weekly";
  else if (/tháng|month/i.test(message)) params.period = "monthly";
  else if (/năm|year/i.test(message)) params.period = "yearly";
  else if (/ngày|hôm|day|daily/i.test(message)) params.period = "daily";

  if (role === "buyer" && userId) params.userId = userId;
  if (role === "seller" && sellerId) params.sellerId = sellerId;

  return params;
}

export { classifyIntent, extractParams };
