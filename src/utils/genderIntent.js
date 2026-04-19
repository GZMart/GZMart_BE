/**
 * Tên danh mục mang tính “khu vực nữ” — lọc khi user hỏi đồ nam.
 * (Kết hợp với tên SP; có unisex thì không loại.)
 */
const CATEGORY_FEMALE_SIGNAL =
  /(thời trang nữ|đồ nữ|phụ nữ|thiếu nữ|cho nữ|váy|đầm|bikini|nữ\b|mỹ phẩm nữ|túi nữ|giày cao gót)/i;

const CATEGORY_MALE_SIGNAL =
  /(thời trang nam|đồ nam|nam giới|cho nam|đàn ông|balo nam|túi nam)/i;

const CATEGORY_UNISEX_SIGNAL = /(unisex|nam nữ|nam & nữ|cả nam và nữ|đôi nam nữ)/i;

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

/**
 * Đồ nữ / từ khóa nữ trong tên SP — loại khi user hỏi đồ nam.
 * Lưu ý: KHÔNG dùng \\b quanh chữ Việt (NỮ, NAM) — engine JS/Mongo hay không khớp → SP nữ vẫn lọt.
 */
const FEMALE_TEXT_REJECT_MALE =
  /(NỮ|Đồ nữ|đồ nữ|Cho nữ|cho nữ|Thời trang nữ|thiếu nữ|phụ nữ|Túi xách nữ|váy |đầm |bikini|đầm\/|váy\/)/i;

/** Đồ nam rõ — loại khi user hỏi đồ nữ (không dùng /NAM/ đơn lẻ — dễ khớp nhầm chữ trong từ khác). */
const MALE_TEXT_REJECT_FEMALE =
  /(Đồ nam|đồ nam|Cho nam|cho nam|Thời trang nam|nam giới|áo nam|quần nam|giày nam|balo nam|túi nam)/i;

/**
 * Túi xách / clutch kiểu nữ — tên không ghi nam/unisex/balo thì không gán cho set đồ nam.
 * (Tránh "Túi Xách Mini ... Đeo Vai" lọt khi chỉ dựa vào từ "túi".)
 */
function looksLikeWomensBagWithoutMaleMarker(name) {
  const n = String(name || "");
  if (!/(túi xách|túi mini|ly hợp|đeo vai|cầm tay mini)/i.test(n)) return false;
  if (/(nam|unisex|balo|đeo chéo nam|for men|mens)/i.test(n)) return false;
  return true;
}

function categoryConflictsMaleIntent(categoryName) {
  const c = String(categoryName || "").trim();
  if (!c) return false;
  if (CATEGORY_UNISEX_SIGNAL.test(c)) return false;
  if (CATEGORY_FEMALE_SIGNAL.test(c)) return true;
  /** Danh mục kết thúc bằng "nữ" (vd. Áo thun nữ) */
  if (/(^|[\s\-/])nữ$/i.test(c)) return true;
  return false;
}

function categoryConflictsFemaleIntent(categoryName) {
  const c = String(categoryName || "").trim();
  if (!c) return false;
  if (CATEGORY_UNISEX_SIGNAL.test(c)) return false;
  if (CATEGORY_MALE_SIGNAL.test(c)) return true;
  /** Danh mục kết thúc bằng "nam" (vd. Quần jean nam) — coi là khu nam */
  if (/(^|[\s\-/])nam$/i.test(c)) return true;
  return false;
}

/**
 * Lọc mảng sản phẩm đã lấy từ DB (hàng rào sau vector/text).
 * @param {Record<string, string>} [categoryIdToName] — map categoryId (string) → Category.name
 */
export function filterProductsByGenderIntent(products, intent, categoryIdToName = {}) {
  if (!intent || !products?.length) return products;
  return products.filter((p) => {
    const cid = p.categoryId != null ? String(p.categoryId) : "";
    const catName = cid && categoryIdToName[cid] != null ? categoryIdToName[cid] : "";
    return productMatchesGenderIntent(p, intent, catName);
  });
}

/**
 * @param {string} [categoryName] — tên danh mục (Category.name), đã resolve từ categoryId
 */
export function productMatchesGenderIntent(product, intent, categoryName = "") {
  const name = String(product?.name || "");
  const tags = typeof product?.tags === "string" ? product.tags : "";
  const cat = String(categoryName || "").trim();
  const catLower = cat.toLowerCase();

  if (intent === "male") {
    if (categoryConflictsMaleIntent(catLower)) return false;
    if (FEMALE_TEXT_REJECT_MALE.test(name) || FEMALE_TEXT_REJECT_MALE.test(tags)) return false;
    if (FEMALE_TEXT_REJECT_MALE.test(cat)) return false;
    if (looksLikeWomensBagWithoutMaleMarker(name)) return false;
    if (/(^|[\s,;])(nữ)(\s|$|[.,!?])/i.test(name) && !/(nam|unisex)/i.test(name)) return false;
    return true;
  }

  if (intent === "female") {
    if (categoryConflictsFemaleIntent(catLower)) return false;
    if (MALE_TEXT_REJECT_FEMALE.test(name) || MALE_TEXT_REJECT_FEMALE.test(tags)) return false;
    if (MALE_TEXT_REJECT_FEMALE.test(cat)) return false;
    if (/(^|[\s,;])(nam)(\s|$|[.,!?])/i.test(name) && !/(nữ|unisex)/i.test(name)) return false;
    return true;
  }

  return true;
}

/**
 * Điều kiện Mongo thêm vào Product.find (chỉ name — tags xử lý sau bằng filterProductsByGenderIntent).
 * Dùng $and + $not đơn giản (NỮ, đồ nữ…) vì $regex với \\b không tin cậy trên tiếng Việt.
 */
export function buildGenderMongoClause(intent) {
  if (intent === "male") {
    return {
      $and: [
        { name: { $not: /NỮ/i } },
        { name: { $not: /đồ nữ|thời trang nữ|cho nữ|thiếu nữ|phụ nữ/i } },
      ],
    };
  }
  if (intent === "female") {
    return {
      $and: [
        {
          name: {
            $not: /đồ nam|thời trang nam|cho nam|nam giới|áo nam|quần nam|giày nam|balo nam|túi nam/i,
          },
        },
      ],
    };
  }
  return {};
}
