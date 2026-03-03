import Voucher from "../models/Voucher.js";
import Order from "../models/Order.js";

/**
 * Voucher Validator Utility
 * Shared validation logic between previewOrder and createOrder
 */

/**
 * Validate and calculate discount for selected voucher IDs
 * Rules:
 *   - Max 1 shop voucher + 1 product voucher
 *   - Each voucher must be active, within time range, usage not exceeded
 *   - Shop voucher: cart must have product from that shop
 *   - Product voucher (specific): cart must have product in appliedProducts
 *   - minBasketPrice must be met for applicable items
 *
 * @param {string[]} voucherIds - Array of voucher _id strings
 * @param {Array} cartItems - Populated cart items (with productId populated)
 * @param {string} userId - Buyer user ID
 * @returns {{ totalDiscount: number, validVouchers: Array, errors: string[] }}
 */
export const validateAndCalculateVouchers = async (
  voucherIds,
  cartItems,
  userId,
) => {
  const errors = [];
  const validVouchers = [];
  let totalDiscount = 0;

  if (!voucherIds || voucherIds.length === 0) {
    return { totalDiscount: 0, validVouchers: [], errors: [] };
  }

  // Fetch vouchers from DB
  const vouchers = await Voucher.find({
    _id: { $in: voucherIds },
  }).lean();

  if (vouchers.length === 0) {
    return {
      totalDiscount: 0,
      validVouchers: [],
      errors: ["No valid vouchers found"],
    };
  }

  // Enforce max 1 shop + 1 product rule
  // Enforce max 1 shop + 1 product rule
  // 'private' vouchers are typically shop-level but hidden, treat them as shop vouchers for the limit
  const shopVouchers = vouchers.filter(
    (v) => v.type === "shop" || v.type === "private",
  );
  const productVouchers = vouchers.filter((v) => v.type === "product");

  if (shopVouchers.length > 1) {
    errors.push("Only 1 shop/private voucher allowed");
    return { totalDiscount: 0, validVouchers: [], errors };
  }
  if (productVouchers.length > 1) {
    errors.push("Only 1 product voucher allowed");
    return { totalDiscount: 0, validVouchers: [], errors };
  }

  const now = new Date();

  // Build cart lookup data
  const cartProductIds = cartItems
    .filter((item) => item.productId)
    .map((item) => item.productId._id?.toString() || item.productId.toString());

  const cartSellerIds = cartItems
    .filter((item) => item.productId?.sellerId)
    .map((item) => item.productId.sellerId.toString());

  for (const voucher of vouchers) {
    // 1. Check status
    if (voucher.status !== "active") {
      errors.push(`Voucher ${voucher.code} is not active`);
      continue;
    }

    // 2. Check time range
    if (new Date(voucher.startTime) > now) {
      errors.push(`Voucher ${voucher.code} has not started yet`);
      continue;
    }
    if (new Date(voucher.endTime) < now) {
      errors.push(`Voucher ${voucher.code} has expired`);
      continue;
    }

    // 3. Check usage limit
    if (voucher.usageCount >= voucher.usageLimit) {
      errors.push(`Voucher ${voucher.code} has reached usage limit`);
      continue;
    }

    // 4. Check maxPerBuyer
    if (voucher.maxPerBuyer) {
      const buyerUsageCount = await Order.countDocuments({
        userId,
        discountCode: { $regex: voucher.code, $options: "i" },
        status: { $nin: ["cancelled", "refunded"] },
      });
      if (buyerUsageCount >= voucher.maxPerBuyer) {
        errors.push(
          `You have already used voucher ${voucher.code} the maximum number of times`,
        );
        continue;
      }
    }

    // 5. Check applicability based on type
    let applicableSubtotal = 0;

    if (voucher.type === "shop" || voucher.type === "private") {
      // Treat private as shop voucher (applicable to all products of the shop)
      const shopItems = cartItems.filter(
        (item) =>
          item.productId?.sellerId?.toString() === voucher.shopId?.toString(),
      );
      if (shopItems.length === 0) {
        errors.push(
          `Voucher ${voucher.code} is not applicable to any product in your cart`,
        );
        continue;
      }

      if (voucher.applyTo === "specific") {
        const appliedProductIdSet = new Set(
          (voucher.appliedProducts || []).map((id) => id.toString()),
        );
        const matchingItems = shopItems.filter((item) => {
          const pid =
            item.productId?._id?.toString() || item.productId?.toString();
          return appliedProductIdSet.has(pid);
        });
        if (matchingItems.length === 0) {
          errors.push(
            `Voucher ${voucher.code} is not applicable to any product in your cart`,
          );
          continue;
        }
        applicableSubtotal = matchingItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
      } else {
        applicableSubtotal = shopItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
      }
    } else if (voucher.type === "product") {
      if (voucher.applyTo === "specific") {
        // Only apply to products in appliedProducts list
        const appliedProductIdSet = new Set(
          (voucher.appliedProducts || []).map((id) => id.toString()),
        );
        const matchingItems = cartItems.filter((item) => {
          const pid =
            item.productId?._id?.toString() || item.productId?.toString();
          return appliedProductIdSet.has(pid);
        });
        if (matchingItems.length === 0) {
          errors.push(
            `Voucher ${voucher.code} is not applicable to any product in your cart`,
          );
          continue;
        }
        applicableSubtotal = matchingItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
      } else {
        // applyTo = "all" → all products from this shop
        const shopItems = cartItems.filter(
          (item) =>
            item.productId?.sellerId?.toString() === voucher.shopId?.toString(),
        );
        if (shopItems.length === 0) {
          errors.push(
            `Voucher ${voucher.code} is not applicable to any product in your cart`,
          );
          continue;
        }
        applicableSubtotal = shopItems.reduce(
          (sum, item) => sum + item.price * item.quantity,
          0,
        );
      }
    } else {
      // Other types not supported in checkout for now
      errors.push(
        `Voucher type "${voucher.type}" is not supported at checkout`,
      );
      continue;
    }

    // 6. Check minBasketPrice
    if (voucher.minBasketPrice && applicableSubtotal < voucher.minBasketPrice) {
      errors.push(
        `Voucher ${voucher.code} requires minimum order of ${voucher.minBasketPrice}`,
      );
      continue;
    }

    // 7. Calculate discount
    let savedAmount = 0;
    if (voucher.discountType === "amount") {
      savedAmount = Math.min(voucher.discountValue, applicableSubtotal);
    } else if (voucher.discountType === "percent") {
      savedAmount = Math.round(
        applicableSubtotal * (voucher.discountValue / 100),
      );
      if (voucher.maxDiscountAmount) {
        savedAmount = Math.min(savedAmount, voucher.maxDiscountAmount);
      }
    }

    if (savedAmount > 0) {
      totalDiscount += savedAmount;
      validVouchers.push({
        voucherId: voucher._id,
        code: voucher.code,
        type: voucher.type,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        savedAmount,
      });
    }
  }

  return { totalDiscount, validVouchers, errors };
};
