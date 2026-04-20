import { registerTool } from "../tools.js";
import { normalizeBuyerQuery } from "../../../utils/buyerQueryNormalizer.js";
import { extractGenderIntent } from "../../../utils/genderIntent.js";
import { coherencePriceFilter } from "../../../utils/priceCoherence.js";
import { runProductSearch, finalizeProductAgentContext } from "./productSearch.js";

const OUTFIT_CUES = [
  "set đồ", "outfit", "phối đồ", "cả bộ", "một bộ", "đồ bộ", "combo đồ",
];

function stripOutfitCues(s) {
  let t = s;
  for (const h of OUTFIT_CUES) {
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(esc, "gi"), " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

/** Gợi ý túi: tránh "túi" chung (hay ra túi xách nữ) khi user hỏi đồ nam */
function bagHintForGender(gender) {
  if (gender === "male") return "balo nam";
  if (gender === "female") return "túi xách nữ";
  return "túi";
}

function getOutfitSlots(gender) {
  const bag = bagHintForGender(gender);
  return [
    { label: "Áo", hint: "áo" },
    { label: "Quần", hint: "quần" },
    { label: "Giày", hint: "giày" },
    { label: "Mũ", hint: "mũ" },
    { label: "Túi", hint: bag },
  ];
}

async function execute({ query, limit = 2 }) {
  const { normalized } = normalizeBuyerQuery(query);
  let base = stripOutfitCues(normalized);
  if (!base || base.length < 2) base = normalized;

  const genderIntent = extractGenderIntent(normalized);
  const slots = getOutfitSlots(genderIntent);
  const genderContextQuery = (normalized && normalized.length > 1 ? normalized : query) || "";

  const perSlot = await Promise.all(
    slots.map(async (slot) => {
      const q = `${base} ${slot.hint}`.trim();
      return runProductSearch({
        query: q,
        limit,
        categoryId: null,
        genderContextQuery,
      });
    }),
  );

  const seen = new Set();
  let allProducts = [];
  for (const r of perSlot) {
    for (const p of r.products || []) {
      const id = p._id?.toString();
      if (id && !seen.has(id)) {
        seen.add(id);
        allProducts.push(p);
      }
    }
  }

  allProducts = coherencePriceFilter(allProducts, 0.45).slice(0, 12);

  if (allProducts.length === 0) {
    return {
      context:
        "Không đủ sản phẩm phù hợp để gợi ý một set đồ đồng giá (có thể do giới tính hoặc từ khóa). Bạn thử nêu rõ ngân sách hoặc kiểu đồ hơn.",
      products: [],
    };
  }

  return finalizeProductAgentContext(
    allProducts,
    `=== GỢI Ý SET ĐỒ (${allProducts.length} món, giá trong cùng khoảng) ===`,
  );
}

registerTool("outfitBundle", {
  description: "Gợi ý set đồ / outfit nhiều món (áo, quần, giày...), giá đồng bộ",
  roles: ["buyer"],
  keywords: [
    "set đồ", "set do", "outfit", "phối đồ", "phoi do", "cả bộ", "ca bo",
    "một bộ", "mot bo", "đồ bộ", "do bo", "combo đồ",
  ],
  execute,
});
