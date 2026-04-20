import { extractSearchTerms } from "./productSearchQuery.js";

/** Map cụm thường gặp → gợi ý từ khóa tìm (mở rộng dần). */
const PHRASE_SYNONYMS = [
  [/áo\s*thun/gi, "áo"],
  [/sơ\s*mi/gi, "sơ mi"],
  [/quần\s*jean/gi, "jean"],
];

/**
 * @returns {{ normalized: string, searchTerms: string[] }}
 */
export function normalizeBuyerQuery(raw) {
  let s = String(raw || "").trim().replace(/\s+/g, " ");
  for (const [re, rep] of PHRASE_SYNONYMS) {
    s = s.replace(re, rep);
  }
  const searchTerms = extractSearchTerms(s);
  return { normalized: s, searchTerms };
}
