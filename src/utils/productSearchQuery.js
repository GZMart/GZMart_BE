/**
 * Escape chuỗi user để dùng trong MongoDB $regex (tránh . * + ? v.v.).
 */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DEFAULT_STOPWORDS = new Set([
  "tôi", "cần", "tìm", "kiếm", "muốn", "mua", "cho", "với", "của", "các", "một",
  "và", "hoặc", "ở", "tại", "nhờ", "giúp", "bạn", "ạ", "nhé", "xin",
]);

/**
 * Từ câu tiếng Việt tự nhiên → các token dùng cho OR regex (bỏ stopword, len >= 2).
 * Nếu sau lọc rỗng → trả về [cả câu đã trim] để không mất ngữ cảnh.
 */
export function extractSearchTerms(raw, stopwords = DEFAULT_STOPWORDS) {
  const q = String(raw || "").trim().toLowerCase();
  if (!q) return [];
  const parts = q.split(/\s+/).filter(Boolean);
  const terms = parts.filter((w) => w.length >= 2 && !stopwords.has(w));
  if (terms.length > 0) return [...new Set(terms)];
  return [q];
}
