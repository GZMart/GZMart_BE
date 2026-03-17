import Deal from "../../../models/Deal.js";
import Voucher from "../../../models/Voucher.js";
import { registerTool } from "../tools.js";

async function execute({ shopId, productId } = {}) {
  const now = new Date();

  const dealFilter = { status: "active", startDate: { $lte: now }, endDate: { $gte: now } };
  if (productId) dealFilter.productId = productId;

  const voucherFilter = {
    status: "active", displaySetting: "public",
    startTime: { $lte: now }, endTime: { $gte: now },
    $expr: { $lt: ["$usageCount", "$usageLimit"] },
  };
  if (shopId) voucherFilter.shopId = shopId;

  const [deals, vouchers] = await Promise.all([
    Deal.find(dealFilter)
      .select("productId type title dealPrice discountPercent quantityLimit soldCount endDate")
      .populate("productId", "name")
      .limit(20).lean(),
    Voucher.find(voucherFilter)
      .select("code name type shopId discountType discountValue maxDiscountAmount minBasketPrice endTime usageLimit usageCount")
      .limit(20).lean(),
  ]);

  const dealLines = deals.map((d) => {
    const label = d.type === "flash_sale" ? "⚡ FLASH SALE" : `🔥 ${d.title || d.type}`;
    const disc = d.dealPrice ? `${d.dealPrice.toLocaleString("vi-VN")}₫` : `-${d.discountPercent}%`;
    const remaining = d.quantityLimit ? `(Còn ${d.quantityLimit - d.soldCount}/${d.quantityLimit})` : "";
    const product = d.productId?.name || "Sản phẩm";
    return `${label}: ${product} → ${disc} ${remaining} | HSD: ${d.endDate.toLocaleDateString("vi-VN")}`;
  });

  const voucherLines = vouchers.map((v) => {
    const disc = v.discountType === "percent"
      ? `-${v.discountValue}%${v.maxDiscountAmount ? ` (max ${v.maxDiscountAmount.toLocaleString("vi-VN")}₫)` : ""}`
      : `-${v.discountValue.toLocaleString("vi-VN")}₫`;
    const remaining = v.usageLimit - v.usageCount;
    const min = v.minBasketPrice ? `Đơn tối thiểu ${v.minBasketPrice.toLocaleString("vi-VN")}₫` : "";
    return `🎟️ Mã ${v.code}: ${disc} | ${min} | Còn ${remaining} lượt | HSD: ${v.endTime.toLocaleDateString("vi-VN")}`;
  });

  const context = `=== KHUYẾN MÃI ĐANG CÓ ===
${dealLines.length > 0 ? `\n🔥 DEAL/FLASH SALE (${dealLines.length}):\n${dealLines.join("\n")}` : "\nKhông có deal nào đang diễn ra."}
${voucherLines.length > 0 ? `\n🎟️ VOUCHER (${voucherLines.length}):\n${voucherLines.join("\n")}` : "\nKhông có voucher khả dụng."}`;

  return { context };
}

registerTool("dealVoucherInfo", {
  description: "Xem deal, flash sale, và voucher đang hoạt động",
  roles: ["buyer", "seller", "admin"],
  keywords: [
    "deal", "flash sale", "khuyến mãi", "giảm giá", "sale",
    "voucher", "mã giảm", "coupon", "code", "mã",
    "ưu đãi", "promotion", "offer",
  ],
  execute,
});
