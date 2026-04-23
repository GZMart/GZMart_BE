import recommendationService from "../services/recommendation.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Get personalized hybrid recommendations
 * @route   GET /api/recommendations/personalized
 * @access  Public (Optional Auth)
 */
export const getPersonalizedRecommendations = asyncHandler(async (req, res, next) => {
  const { limit = 16 } = req.query;
  const userId = req.user ? req.user._id : null;

  let products = [];
  
  if (userId) {
    products = await recommendationService.getPersonalizedRecommendations(userId, parseInt(limit));
  } else {
    // If not logged in, fallback to generic trending recommendations
    const { getTodayRecommendations } = await import("../services/product.service.js");
    products = await getTodayRecommendations(parseInt(limit));
  }

  res.status(200).json({
    success: true,
    data: products,
  });
});
