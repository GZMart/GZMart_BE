// Simple SKU generator utility
// Generates readable SKU like: TSH-RED-XL-4F7A
const alphaNum = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "";
  for (let i = 0; i < 4; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

const slugPart = (str) => {
  if (!str) return "";
  return String(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();
};

export const generateSKU = (productName, tiers = [], tierIndex = []) => {
  // Product short: try acronym of words (max 4 chars) or first word trimmed
  const words = String(productName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let prodShort = "";
  if (words.length === 0) prodShort = "PRD";
  else if (words.length === 1) prodShort = slugPart(words[0]).slice(0, 4);
  else {
    prodShort = words
      .map((w) => w[0])
      .join("")
      .slice(0, 4)
      .toUpperCase();
  }

  // Build option parts from tierIndex
  const optionParts = [];
  for (let i = 0; i < (tierIndex?.length || 0); i++) {
    const idx = tierIndex[i];
    const tier = tiers[i];
    if (
      tier &&
      Array.isArray(tier.options) &&
      tier.options[idx] !== undefined
    ) {
      optionParts.push(slugPart(tier.options[idx]));
    }
  }

  const suffix = alphaNum();
  const parts = [prodShort, ...optionParts, suffix].filter(Boolean);
  return parts.join("-");
};

export default generateSKU;
