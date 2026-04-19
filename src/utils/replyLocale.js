/**
 * Ước lượng ngôn ngữ user để trả lời cùng ngôn ngữ (không thay thế i18n đầy đủ).
 * @returns {"vi"|"en"}
 */
export function detectPrimaryLocale(message) {
  const s = String(message || "").trim();
  if (!s) return "vi";
  if (/[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i.test(s)) {
    return "vi";
  }
  const letters = (s.match(/[a-zA-Z]/g) || []).length;
  if (letters >= 16 && letters / s.length > 0.45) return "en";
  return "vi";
}
