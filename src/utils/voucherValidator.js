import Voucher from "../models/Voucher.js";
import Order from "../models/Order.js";
import Follow from "../models/Follow.js";
import LiveSession from "../models/LiveSession.js";

/**
 * Voucher Validator Utility
 * Shared validation logic between previewOrder and createOrder
 */

/**
 * Kiểm tra user có phải là người mua mới (chưa có đơn thành công nào)
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isNewBuyer(userId) {
  const completedOrders = await Order.countDocuments({
    userId,
    status: { $in: ["completed", "delivered"] },
  });
  return completedOrders === 0;
}

/**
 * Kiểm tra user có phải là khách quen (đã mua >= minOrderCount đơn)
 * @param {string} userId
 * @param {number} minOrderCount
 * @returns {Promise<boolean>}
 */
async function isRepeatBuyer(userId, minOrderCount = 2) {
  const completedOrders = await Order.countDocuments({
    userId,
    status: { $in: ["completed", "delivered"] },
  });
  return completedOrders >= minOrderCount;
}

/**
 * Kiểm tra user đã follow shop chưa
 * @param {string} userId
 * @param {string} shopId
 * @returns {Promise<boolean>}
 */
async function isShopFollower(userId, shopId) {
  if (!shopId) return false;
  const follow = await Follow.findOne({
    followerId: userId,
    followingId: shopId,
  });
  return !!follow;
}

/**
 * Validate and calculate discount for selected voucher IDs
 * Rules:
 *   - Max 1 shop/private + 1 product + 1 system (system_shipping | system_order | system_vip_daily)
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

  // Giới hạn số lượng voucher theo loại:
  //   - Tối đa 1 voucher shop PER SELLER (multi-seller cart: mỗi seller 1 mã)
  //   - Tối đa 1 product voucher
  //   - Tối đa 1 system voucher
  const shopVouchers = vouchers.filter(
    (v) => v.type === "shop" || v.type === "private",
  );
  const productVouchers = vouchers.filter((v) => v.type === "product");
  const systemVouchers = vouchers.filter((v) =>
    [
      "system_shipping",
      "system_order",
      "system_vip_daily",
    ].includes(v.type),
  );

  // Group shop vouchers by shopId; each seller allowed max 1
  const shopVouchersByShop = new Map();
  for (const v of shopVouchers) {
    const sid = v.shopId?.toString() || "__no_shop__";
    if (!shopVouchersByShop.has(sid)) {
      shopVouchersByShop.set(sid, []);
    }
    shopVouchersByShop.get(sid).push(v);
  }
  for (const [sid, group] of shopVouchersByShop) {
    if (group.length > 1) {
      errors.push(`Chỉ được dùng 1 voucher của mỗi shop (shopId: ${sid})`);
      return { totalDiscount: 0, validVouchers: [], errors };
    }
  }

  if (productVouchers.length > 1) {
    errors.push("Only 1 product voucher allowed");
    return { totalDiscount: 0, validVouchers: [], errors };
  }
  if (systemVouchers.length > 1) {
    errors.push(
      "Chỉ được dùng 1 voucher hệ thống (freeship / giảm đơn / VIP) trên cùng một đơn",
    );
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
      // Shop voucher áp dụng trên phần hàng của seller đó (multi-seller được phép)
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
    } else if (voucher.type === "live") {
      // Live vouchers must be used within their bound session
      if (!voucher.liveSessionId) {
        errors.push(`Voucher ${voucher.code} is not linked to any live session`);
        continue;
      }
      const { getRoomViewers } = await import("../services/livestreamRedis.service.js");
      const session = await LiveSession.findById(voucher.liveSessionId).lean();
      if (!session) {
        errors.push(`Voucher ${voucher.code} session is no longer active`);
        continue;
      }
      if (session.status !== "live") {
        errors.push(`Voucher ${voucher.code} can only be used during the live session`);
        continue;
      }
      const viewerIds = await getRoomViewers(voucher.liveSessionId.toString());
      const isInSession = viewerIds.includes(userId.toString());
      if (!isInSession) {
        errors.push(`Voucher ${voucher.code} can only be used while watching the live session`);
        continue;
      }
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
    } else if (voucher.type === "new_buyer") {
      // Check if user is a new buyer
      const eligible = await isNewBuyer(userId);
      if (!eligible) {
        errors.push(`Voucher ${voucher.code} is only valid for first-time buyers`);
        continue;
      }
      // new_buyer vouchers are not tied to specific cart items — they're standalone discounts
      // Apply discount on total cart value from this shop
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
      // minBasketPrice check và discount calculation được xử lý ở cuối switch
    } else if (voucher.type === "repeat_buyer") {
      // Check if user is a repeat buyer
      const minOrders = voucher.minOrderCount || 2;
      const eligible = await isRepeatBuyer(userId, minOrders);
      if (!eligible) {
        errors.push(
          `Voucher ${voucher.code} requires at least ${minOrders} completed orders`,
        );
        continue;
      }
      // Apply discount on total cart value from this shop
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
      // minBasketPrice check và discount calculation được xử lý ở cuối switch
    } else if (voucher.type === "follower") {
      // Check if user follows the shop
      const eligible = await isShopFollower(userId, voucher.shopId?.toString());
      if (!eligible) {
        errors.push(`You must follow this shop to use voucher ${voucher.code}`);
        continue;
      }
      // Apply discount on total cart value from this shop
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
      // minBasketPrice check và discount calculation được xử lý ở cuối switch
    } else if (
      voucher.type === "system_shipping" ||
      voucher.type === "system_order" ||
      voucher.type === "system_vip_daily"
    ) {
      // System/admin voucher — applies to entire cart regardless of shop
      applicableSubtotal = cartItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0,
      );
      if (applicableSubtotal === 0) {
        errors.push(`Voucher ${voucher.code} is not applicable to an empty cart`);
        continue;
      }
      // minBasketPrice check và discount calculation được xử lý ở cuối switch
    } else {
      // Other types not supported in checkout for now
      errors.push(
        `Voucher type "${voucher.type}" is not supported at checkout`,
      );
      continue;
    }

    // 6. Check minBasketPrice (dùng chung cho tất cả types đã xử lý ở trên)
    if (voucher.minBasketPrice && applicableSubtotal < voucher.minBasketPrice) {
      errors.push(
        `Voucher ${voucher.code} requires minimum order of ${voucher.minBasketPrice}`,
      );
      continue;
    }

    // 7. Calculate discount (dùng chung cho tất cả types đã xử lý ở trên)
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
