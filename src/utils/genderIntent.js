/**
 * Suy ra giới từ câu tiếng Việt (không có field gender trên Product — lọc theo text name/tags).
 * @returns {"male"|"female"|null}
 */
function hasMaleHint(s) {
  if (/nam định|nam trung/i.test(s)) return false;
  return (
    /đồ nam|thời trang nam|cho nam|nam giới|áo nam|quần nam|giày nam|balo nam|túi nam/i.test(s) ||
    /(^|[\s])nam$/i.test(s) ||
    /đàn ông|boyfriend|mens\b|men\b/i.test(s)
  );
}

/** Không dùng \\b cho chữ tiếng Việt (ví dụ "nữ" cuối câu). */
function hasFemaleHint(s) {
  return (
    /(^|\s)(nữ|đồ nữ|thời trang nữ|cho nữ|nữ giới|thiếu nữ)(\s|$|[.,!?])/i.test(s) ||
    /đầm|váy đầm|váy |bikini|women\b|womens\b|ladies\b/i.test(s)
  );
}

export function extractGenderIntent(raw) {
  const s = String(raw || "").toLowerCase().trim();
  const maleHints = hasMaleHint(s);
  const femaleHints = hasFemaleHint(s);

  if (maleHints && femaleHints) return null;
  if (maleHints) return "male";
  if (femaleHints) return "female";
  return null;
}

/** Tên/tag có dấu hiệu rõ là đồ nữ — loại khi user hỏi đồ nam */
const FEMALE_TEXT_REJECT_MALE =
  /(\bNỮ\b|NỮ[\s\|\-\/]|\(NỮ\)|Đồ nữ|đồ nữ|Cho nữ|cho nữ|Thời trang nữ|thiếu nữ|phụ nữ|Túi xách nữ|váy |đầm |bikini |đầm\/|váy\/)/i;

/** Đồ nam rõ — loại khi user hỏi đồ nữ */
const MALE_TEXT_REJECT_FEMALE =
  /(\bNAM\b|NAM[\s\|\-\/]|\(NAM\)|Đồ nam|đồ nam|Cho nam|cho nam|Thời trang nam|nam giới)/i;

/**
 * Lọc mảng sản phẩm đã lấy từ DB (hàng rào sau vector/text).
 */
export function filterProductsByGenderIntent(products, intent) {
  if (!intent || !products?.length) return products;
  return products.filter((p) => productMatchesGenderIntent(p, intent));
}

export function productMatchesGenderIntent(product, intent) {
  const name = String(product?.name || "");
  const tags = typeof product?.tags === "string" ? product.tags : "";
  const blob = `${name} ${tags}`;

  if (intent === "male") {
    if (FEMALE_TEXT_REJECT_MALE.test(name) || FEMALE_TEXT_REJECT_MALE.test(tags)) return false;
    if (/(^|[\s,;])(nữ)(\s|$|[.,!?])/i.test(name) && !/(nam|unisex)/i.test(name)) return false;
    return true;
  }

  if (intent === "female") {
    if (MALE_TEXT_REJECT_FEMALE.test(name) || MALE_TEXT_REJECT_FEMALE.test(tags)) return false;
    if (/(^|[\s,;])(nam)(\s|$|[.,!?])/i.test(name) && !/(nữ|unisex)/i.test(name)) return false;
    return true;
  }

  return true;
}

/**
 * Điều kiện Mongo thêm vào Product.find (chỉ name — tags xử lý sau bằng filterProductsByGenderIntent).
 */
export function buildGenderMongoClause(intent) {
  if (intent === "male") return { name: { $not: FEMALE_TEXT_REJECT_MALE } };
  if (intent === "female") return { name: { $not: MALE_TEXT_REJECT_FEMALE } };
  return {};
}
