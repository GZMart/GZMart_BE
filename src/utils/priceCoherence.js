export function minModelPrice(p) {
  const prices = (p.models || []).map((m) => m.price).filter((n) => n > 0);
  if (prices.length) return Math.min(...prices);
  return p.originalPrice > 0 ? p.originalPrice : null;
}

/**
 * Giữ sản phẩm có giá trong [median * (1-spread), median * (1+spread)].
 * @param {number} spread — ví dụ 0.45 → ~±45% quanh trung vị
 */
export function coherencePriceFilter(products, spread = 0.45) {
  const priced = products.filter((p) => minModelPrice(p) != null);
  if (priced.length < 2) return products;
  const vals = priced.map((p) => minModelPrice(p)).sort((a, b) => a - b);
  const mid = vals[Math.floor(vals.length / 2)];
  const lo = mid * (1 - spread);
  const hi = mid * (1 + spread);
  return priced.filter((p) => {
    const x = minModelPrice(p);
    return x >= lo && x <= hi;
  });
}
