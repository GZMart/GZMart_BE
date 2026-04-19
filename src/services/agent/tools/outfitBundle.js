import { registerTool } from "../tools.js";
import { normalizeBuyerQuery } from "../../../utils/buyerQueryNormalizer.js";
import { coherencePriceFilter } from "../../../utils/priceCoherence.js";
import { runProductSearch, finalizeProductAgentContext } from "./productSearch.js";

const OUTFIT_SLOTS = [
  { label: "Áo", hint: "áo" },
  { label: "Quần", hint: "quần" },
  { label: "Giày", hint: "giày" },
  { label: "Mũ", hint: "mũ" },
  { label: "Túi", hint: "túi" },
];

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

async function execute({ query, limit = 2 }) {
  const { normalized } = normalizeBuyerQuery(query);
  let base = stripOutfitCues(normalized);
  if (!base || base.length < 2) base = normalized;

  const perSlot = await Promise.all(
    OUTFIT_SLOTS.map(async (slot) => {
      const q = `${base} ${slot.hint}`.trim();
      return runProductSearch({ query: q, limit, categoryId: null });
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
        "Không đủ sản phẩm phù hợp để gợi ý một set đồ đồng giá. Bạn thử nêu ngân sách hoặc phong cách cụ thể hơn.",
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
