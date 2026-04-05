/**
 * Chuẩn hóa SKU: uppercase + loại bỏ dấu tiếng Việt.
 * Dùng cho mọi thao tác so sánh / tìm kiếm / lưu SKU.
 *
 * Ví dụ:
 *   normalizeSku("giày017-1-72c9") → "GIAY017-1-72C9"
 *   normalizeSku("GI%C3%80Y017-1") → "GIAY017-1"   (đã decode URL trước)
 *   normalizeSku("  TSHIRT-XL  ")  → "TSHIRT-XL"
 */
export function normalizeSku(s) {
  if (!s || typeof s !== "string") return "";
  return s
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/Đ/g, "D");             // Đ → D (tiếng Việt)
}

/**
 * Kiểm tra hai SKU có khớp nhau sau khi chuẩn hóa.
 */
export function skuMatch(a, b) {
  if (!a || !b) return false;
  return normalizeSku(a) === normalizeSku(b);
}
