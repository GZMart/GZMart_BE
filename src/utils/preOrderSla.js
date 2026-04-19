/**
 * SKU có bật pre-order (`Product.preOrderDays` > 0) — được phép đặt vượt tồn kho hiện tại;
 * kho vật lý chỉ trừ khi fulfillment (không nằm trong scope snapshot hiện tại).
 */
export function isPreOrderProduct(product) {
  return Number(product?.preOrderDays) > 0;
}

/**
 * Pre-order SLA snapshot — policy: docs/policy-preorder-sla.md
 * @param {unknown} preOrderDaysRaw
 * @param {Date|string|number} [anchorDate] — typically Order.createdAt
 * @returns {{ isPreOrder: boolean, preOrderDaysSnapshot: number, estimatedShipBy: Date|null }}
 */
export function buildPreOrderFieldsFromProduct(preOrderDaysRaw, anchorDate) {
  const preOrderDaysSnapshot = Math.max(0, Number(preOrderDaysRaw) || 0);
  const isPreOrder = preOrderDaysSnapshot > 0;
  let estimatedShipBy = null;
  if (isPreOrder && anchorDate != null) {
    const anchor = new Date(anchorDate);
    if (!Number.isNaN(anchor.getTime())) {
      estimatedShipBy = new Date(anchor);
      estimatedShipBy.setDate(estimatedShipBy.getDate() + preOrderDaysSnapshot);
    }
  }
  return { isPreOrder, preOrderDaysSnapshot, estimatedShipBy };
}

/** Trạng thái đơn: đã qua giai đoạn cần cảnh báo quá hạn SLA pre-order (dùng chung API + query). */
export const PREORDER_SLA_BREACH_SUPPRESSED_STATUSES = [
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "refunded",
  "refund_pending",
  "under_investigation",
];

/**
 * Seller/ops: đơn có line pre-order đã quá estimatedShipBy nhưng chưa giao xong.
 * @param {string} orderStatus
 * @param {Array<{ isPreOrder?: boolean, estimatedShipBy?: Date|string|null }>} items
 */
export function orderHasPreOrderSlaBreach(orderStatus, items) {
  const status = String(orderStatus || "").toLowerCase();
  const noBreachStatuses = new Set(PREORDER_SLA_BREACH_SUPPRESSED_STATUSES);
  if (noBreachStatuses.has(status)) {
    return false;
  }
  const now = Date.now();
  return (items || []).some(
    (it) =>
      it?.isPreOrder &&
      it?.estimatedShipBy &&
      new Date(it.estimatedShipBy).getTime() < now,
  );
}
