/**
 * Tier used for one image per variant group (align với FE getVariantImageGroupTierIndex).
 * Body tiers: { name, options } — không luôn có type.
 */
const normalize = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");

function resolveImageTierKeyFromName(name) {
  const n = normalize(name);
  if (!n) return "";
  if (/\b(color|colour)\b/.test(n) || n.includes("mau")) return "COLOR";
  if (n.includes("size") || n.includes("kich co") || n.includes("kick co")) return "SIZE";
  if (n.includes("gender") || n.includes("gioi tinh")) return "GENDER";
  return "";
}

export function getImageGroupTierIndexForProductTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length < 2) {
    return 0;
  }
  for (let i = 0; i < tiers.length; i += 1) {
    if (tiers[i]?.type === "COLOR") {
      return i;
    }
  }
  for (let i = 0; i < tiers.length; i += 1) {
    if (resolveImageTierKeyFromName(tiers[i]?.name) === "COLOR") {
      return i;
    }
  }
  return 0;
}
