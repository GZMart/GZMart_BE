import Deal from "../models/Deal.js";
import { ErrorResponse } from "../utils/errorResponse.js";

// Full populate config matching FE spec fields
const PRODUCT_POPULATE = {
  path: "productId",
  select:
    "name description images price originalPrice isNewArrival rating reviewCount sold brand categoryId models tiers sku status",
  match: { status: { $ne: "inactive" } },
  populate: {
    path: "categoryId",
    select: "name _id",
  },
};

/**
 * Enrich a deal (lean object) with computed price fields and FE-compatible shape.
 */
function enrichDeal(deal) {
  if (!deal.productId) return deal;

  const product = deal.productId;
  const discount = deal.discountPercent || 0;

  // Map category: categoryId → category
  if (product.categoryId) {
    product.category = product.categoryId;
    delete product.categoryId;
  }

  // Map isNewArrival → isNew
  product.isNew = product.isNewArrival ?? false;

  // Map tiers → tier_variations
  product.tier_variations = product.tiers || [];

  const models = product.models || [];

  if (models.length > 0) {
    const activePrices = models
      .filter((m) => m.isActive !== false)
      .map((m) => m.price)
      .filter((p) => typeof p === "number");

    if (activePrices.length > 0) {
      const minPrice = Math.min(...activePrices);
      const maxPrice = Math.max(...activePrices);

      if (deal.dealPrice != null) {
        deal.discountedMinPrice = deal.dealPrice;
        deal.discountedMaxPrice = deal.dealPrice;
        deal.discountedPrice = deal.dealPrice;
        deal.discountPercent = Math.round(((minPrice - deal.dealPrice) / minPrice) * 100);
      } else {
        deal.dealPrice = Math.round(minPrice * (1 - discount / 100));
        deal.discountedMinPrice = deal.dealPrice;
        deal.discountedMaxPrice = Math.round(maxPrice * (1 - discount / 100));
        deal.discountedPrice = deal.dealPrice;
      }
    }
  } else {
    // Single-model or price on product itself
    const basePrice = product.originalPrice || product.price || 0;
    if (deal.dealPrice != null) {
        deal.discountedPrice = deal.dealPrice;
        deal.discountedMinPrice = deal.dealPrice;
        deal.discountPercent = Math.round(((basePrice - deal.dealPrice) / basePrice) * 100);
    } else {
        deal.dealPrice = Math.round(basePrice * (1 - discount / 100));
        deal.discountedPrice = deal.dealPrice;
        deal.discountedMinPrice = deal.dealPrice;
    }
  }

  return deal;
}

class DealService {
  /**
   * Build the base active-deal query
   */
  _activeQuery(extra = {}) {
    const now = new Date();
    return {
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
      ...extra,
    };
  }

  /**
   * Fetch, filter and enrich deals
   */
  async _fetchDeals(query, { page = 1, limit = 20 } = {}) {
    const deals = await Deal.find(query)
      .populate(PRODUCT_POPULATE)
      .sort("-priority -createdAt")
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const valid = deals.filter((d) => {
      if (!d.productId) return false;
      if (d.quantityLimit && d.soldCount >= d.quantityLimit) return false;
      return true;
    });

    const enriched = valid.map(enrichDeal);
    const total = await Deal.countDocuments(query);

    return {
      deals: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /** GET /api/deals — all active deals */
  async getAllActiveDeals(options = {}) {
    return this._fetchDeals(this._activeQuery(), options);
  }

  /** GET /api/deals/flash-sales */
  async getFlashSales(options = {}) {
    return this._fetchDeals(this._activeQuery({ type: "flash_sale" }), options);
  }

  /** GET /api/deals/daily-deals */
  async getDailyDeals(options = {}) {
    return this._fetchDeals(this._activeQuery({ type: "daily_deal" }), options);
  }

  /** GET /api/deals/weekend-deals */
  async getWeekendDeals(options = {}) {
    return this._fetchDeals(this._activeQuery({ type: "weekly_deal" }), options);
  }

  /** GET /api/deals/product/:productId */
  async getActiveDealByProduct(productId) {
    const now = new Date();

    const deal = await Deal.findOne({
      productId,
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    })
      .populate(PRODUCT_POPULATE)
      .lean();

    if (!deal || !deal.productId) return null;
    if (deal.quantityLimit && deal.soldCount >= deal.quantityLimit) return null;

    return enrichDeal(deal);
  }

  /** GET /api/deals/:dealId */
  async getDealById(dealId) {
    const deal = await Deal.findById(dealId)
      .populate(PRODUCT_POPULATE)
      .lean();

    if (!deal) {
      throw new ErrorResponse("Deal not found", 404);
    }

    return enrichDeal(deal);
  }

  /**
   * GET /api/deals/my-deals (authenticated)
   * Currently returns stub — extend once user-deal participation is tracked.
   */
  async getMyDeals(userId) {
    // Future: query a UserDeal collection for pending/approved deals
    return {
      pendingDeals: [],
      approvedDeals: [],
    };
  }

  /** Cron: update deal statuses */
  async updateDealStatuses() {
    const now = new Date();

    await Deal.updateMany(
      { status: "active", endDate: { $lt: now } },
      { $set: { status: "expired" } }
    );

    await Deal.updateMany(
      { status: "pending", startDate: { $lte: now }, endDate: { $gte: now } },
      { $set: { status: "active" } }
    );

    // Expire quantity-exhausted deals
    const quantityDeals = await Deal.find({
      status: "active",
      quantityLimit: { $ne: null },
    }).select("soldCount quantityLimit");

    const toExpire = quantityDeals
      .filter((d) => d.soldCount >= d.quantityLimit)
      .map((d) => d._id);

    if (toExpire.length > 0) {
      await Deal.updateMany(
        { _id: { $in: toExpire } },
        { $set: { status: "expired" } }
      );
    }
  }
}

export default new DealService();
