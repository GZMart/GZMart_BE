import { getActivePromotionsForProduct } from "../services/product.service.js";

/**
 * GET /api/products/:productId/promotions
 * Public endpoint — returns active promotions for a product
 */
export const getProductPromotions = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) {
      return res
        .status(400)
        .json({ success: false, message: "Product ID is required" });
    }

    const promotions = await getActivePromotionsForProduct(productId);
    res.json({ success: true, data: promotions });
  } catch (error) {
    console.error("Error fetching product promotions:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/products/promotions/batch
 * Public endpoint — returns active promotions for multiple products
 * Body: { productIds: ["id1", "id2", ...] }
 */
export const getProductPromotionsBatch = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "productIds array is required" });
    }

    // Limit to 50 products per batch to prevent abuse
    const limitedIds = productIds.slice(0, 50);

    const results = await Promise.all(
      limitedIds.map(async (id) => {
        try {
          const promo = await getActivePromotionsForProduct(id);
          return [id, promo];
        } catch {
          return [id, null];
        }
      })
    );

    const promotionsMap = Object.fromEntries(results);
    res.json({ success: true, data: promotionsMap });
  } catch (error) {
    console.error("Error fetching batch promotions:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
