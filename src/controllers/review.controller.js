import reviewService from "../services/review.service.js";
import { asyncHandler } from "../middlewares/async.middleware.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * @desc    Create a review for a product
 * @route   POST /api/reviews
 * @access  Private
 */
export const createReview = asyncHandler(async (req, res, next) => {
  const { productId, rating, title, content, images, orderId, variant } =
    req.body;

  // Validation
  if (!productId && !orderId) {
    return next(new ErrorResponse("Product ID or Order ID is required", 400));
  }

  if (!rating || rating < 1 || rating > 5) {
    return next(
      new ErrorResponse("Rating must be a number between 1 and 5", 400),
    );
  }

  if (!content || content.trim().length < 10) {
    return next(
      new ErrorResponse(
        "Review content is required and must be at least 10 characters",
        400,
      ),
    );
  }

  const reviewData = {
    rating: parseInt(rating),
    title: title || null,
    content: content.trim(),
    variant: variant || null,
    images: images || [],
  };

  if (orderId) {
    const reviews = await reviewService.createOrUpdateOrderReviews(
      req.user._id,
      orderId,
      reviewData,
    );

    return res.status(200).json({
      success: true,
      message: "Order reviews saved successfully",
      data: reviews,
    });
  }

  const review = await reviewService.createReview(
    req.user._id,
    productId,
    reviewData,
    orderId,
  );

  return res.status(201).json({
    success: true,
    message: "Review created successfully",
    data: review,
  });
});

/**
 * @desc    Get current user's reviews for an order
 * @route   GET /api/reviews/order/:orderId
 * @access  Private
 */
export const getOrderReviews = asyncHandler(async (req, res, next) => {
  const { orderId } = req.params;

  const reviews = await reviewService.getOrderReviews(req.user._id, orderId);

  res.status(200).json({
    success: true,
    message: "Order reviews retrieved successfully",
    data: reviews,
  });
});

/**
 * @desc    Get reviews for a product
 * @route   GET /api/reviews/product/:productId
 * @access  Public
 */
export const getProductReviews = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;
  const { page = 1, limit = 10, rating, sortBy } = req.query;

  const filters = {
    page: parseInt(page),
    limit: parseInt(limit),
    rating: rating ? parseInt(rating) : null,
    sortBy: sortBy || "recent",
  };

  const result = await reviewService.getProductReviews(
    productId,
    filters,
    req.user?._id || null,
  );

  res.status(200).json({
    success: true,
    message: "Reviews retrieved successfully",
    ...result,
  });
});

/**
 * @desc    Get user's reviews
 * @route   GET /api/reviews/user
 * @access  Private
 */
export const getUserReviews = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10 } = req.query;

  const filters = {
    page: parseInt(page),
    limit: parseInt(limit),
  };

  const result = await reviewService.getUserReviews(req.user._id, filters);

  res.status(200).json({
    success: true,
    message: "Your reviews retrieved successfully",
    ...result,
  });
});

/**
 * @desc    Get single review
 * @route   GET /api/reviews/:reviewId
 * @access  Public
 */
export const getReview = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;

  const review = await reviewService.getReview(reviewId);

  res.status(200).json({
    success: true,
    message: "Review retrieved successfully",
    data: review,
  });
});

/**
 * @desc    Update a review
 * @route   PUT /api/reviews/:reviewId
 * @access  Private
 */
export const updateReview = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;
  const { rating, title, content, images } = req.body;

  // Basic validation
  if (rating && (rating < 1 || rating > 5)) {
    return next(new ErrorResponse("Rating must be between 1 and 5", 400));
  }

  if (content && content.trim().length < 10) {
    return next(
      new ErrorResponse("Review content must be at least 10 characters", 400),
    );
  }

  const updateData = {
    rating: rating ? parseInt(rating) : undefined,
    title: title !== undefined ? title || null : undefined,
    content: content ? content.trim() : undefined,
    images: images || undefined,
  };

  // Remove undefined fields
  Object.keys(updateData).forEach(
    (key) => updateData[key] === undefined && delete updateData[key],
  );

  const review = await reviewService.updateReview(
    reviewId,
    req.user._id,
    updateData,
  );

  res.status(200).json({
    success: true,
    message: "Review updated successfully",
    data: review,
  });
});

/**
 * @desc    Delete a review
 * @route   DELETE /api/reviews/:reviewId
 * @access  Private
 */
export const deleteReview = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;

  const result = await reviewService.deleteReview(reviewId, req.user._id);

  res.status(200).json({
    success: true,
    message: result.message,
  });
});

/**
 * @desc    Mark review as helpful
 * @route   POST /api/reviews/:reviewId/helpful
 * @access  Private
 */
export const markHelpful = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;

  const review = await reviewService.markHelpful(reviewId, req.user._id);

  res.status(200).json({
    success: true,
    message: "Review marked as helpful",
    data: review,
  });
});

/**
 * @desc    Mark review as unhelpful
 * @route   POST /api/reviews/:reviewId/unhelpful
 * @access  Private
 */
export const markUnhelpful = asyncHandler(async (req, res, next) => {
  const { reviewId } = req.params;

  const review = await reviewService.markUnhelpful(reviewId, req.user._id);

  res.status(200).json({
    success: true,
    message: "Review marked as unhelpful",
    data: review,
  });
});

/**
 * @desc    Get review statistics for a product
 * @route   GET /api/reviews/stats/:productId
 * @access  Public
 */
export const getProductReviewStats = asyncHandler(async (req, res, next) => {
  const { productId } = req.params;

  const stats = await reviewService.getProductReviewStats(productId);

  res.status(200).json({
    success: true,
    message: "Review statistics retrieved successfully",
    data: stats,
  });
});
