import mongoose from "mongoose";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { updateShopRatingForSeller } from "./shopRating.service.js";

class ReviewService {
  formatVariantLabel(tierSelections) {
    if (!tierSelections) return null;
    const entries =
      tierSelections instanceof Map
        ? Array.from(tierSelections.entries())
        : Object.entries(tierSelections || {});

    const label = entries
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");

    return label || null;
  }

  /**
   * Create a new review
   */
  async createReview(userId, productId, reviewData, orderId = null) {
    console.log("createReview called:", { userId, productId, orderId });

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    // Check if user has already reviewed this product FOR THIS SPECIFIC ORDER
    const existingReview = await Review.findOne({
      productId,
      userId,
      orderId: orderId || null,
    });

    if (existingReview) {
      throw new ErrorResponse(
        "You have already reviewed this product for this order",
        400,
      );
    }

    // Verify purchase if orderId is provided
    let verifiedPurchase = false;
    if (orderId) {
      console.log("=== DEBUG: Fetching order ===");
      try {
        const order = await Order.findOne({
          _id: orderId,
          userId,
        }).populate("items");

        if (order && order.items && order.items.length > 0) {
          const hasProduct = order.items.some((item) => {
            return (
              item.productId &&
              item.productId.toString() === productId.toString()
            );
          });

          if (hasProduct) {
            verifiedPurchase = true;
            console.log("Verified purchase: true");
          }
        }
      } catch (error) {
        console.log("Error verifying purchase:", error.message);
      }
    }

    let review;
    try {
      // Create new review
      review = await Review.create({
        productId,
        userId,
        orderId: orderId || null,
        rating: reviewData.rating,
        title: reviewData.title || null,
        content: reviewData.content,
        variant: reviewData.variant || null,
        images: reviewData.images || [],
        verifiedPurchase,
        status: "approved",
      });
    } catch (error) {
      console.error("Error creating review:", error);
      // Ném lỗi rõ ràng nếu có lỗi từ DB (như thiếu trường bắt buộc, v.v.)
      throw new ErrorResponse(error.message || "Failed to create review", 400);
    }

    console.log("Review created:", review._id);

    // Update product rating and reviewCount
    await this.updateProductRating(productId);

    // Populate and return
    const populatedReview = await Review.findById(review._id)
      .populate({
        path: "userId",
        select: "fullName avatar",
      })
      .populate({
        path: "productId",
        select: "name slug images",
      });

    return populatedReview;
  }

  /**
   * Get user's reviews for a specific order
   */
  async getOrderReviews(userId, orderId) {
    const order = await Order.findOne({ _id: orderId, userId }).select("_id");
    if (!order) {
      throw new ErrorResponse("Order not found or does not belong to you", 404);
    }

    const reviews = await Review.find({ userId, orderId })
      .populate({
        path: "productId",
        select: "name slug images",
      })
      .sort({ createdAt: -1 })
      .lean();

    return reviews;
  }

  /**
   * Create or update reviews for all products in an order
   */
  async createOrUpdateOrderReviews(userId, orderId, reviewData) {
    const order = await Order.findOne({ _id: orderId, userId }).populate({
      path: "items",
      select: "productId tierSelections",
    });

    if (!order) {
      throw new ErrorResponse("Order not found or does not belong to you", 404);
    }

    if (!order.items || order.items.length === 0) {
      throw new ErrorResponse("Order has no items to review", 400);
    }

    const uniqueItemsByProduct = new Map();
    for (const item of order.items) {
      const pid = item?.productId?.toString?.() || item?.productId;
      if (!pid) continue;
      if (!uniqueItemsByProduct.has(pid)) {
        uniqueItemsByProduct.set(pid, item);
      }
    }

    const touchedProductIds = new Set();
    const resultReviews = [];

    for (const [, item] of uniqueItemsByProduct) {
      const productId = item.productId;
      const variantLabel = this.formatVariantLabel(item.tierSelections);

      const product = await Product.findById(productId).select("_id");
      if (!product) continue;

      let review = await Review.findOne({ userId, orderId, productId });

      if (review) {
        // UPDATE (EDIT) existing review for THIS order
        review.rating = reviewData.rating;
        review.title = reviewData.title || null;
        review.content = reviewData.content;
        review.images = reviewData.images || [];
        review.variant = variantLabel || reviewData.variant || null;
        review.verifiedPurchase = true;
        review.status = "approved";
        await review.save();
      } else {
        // CREATE new review for THIS order
        try {
          review = await Review.create({
            productId,
            userId,
            orderId,
            rating: reviewData.rating,
            title: reviewData.title || null,
            content: reviewData.content,
            variant: variantLabel || reviewData.variant || null,
            images: reviewData.images || [],
            verifiedPurchase: true,
            status: "approved",
          });
        } catch (error) {
          console.error(
            `Failed to create review for product ${productId}:`,
            error.message,
          );
          continue; // Skip if creation fails for this specific item
        }
      }

      touchedProductIds.add(productId.toString());
      resultReviews.push(review);
    }

    // Recompute product rating/reviewCount for all touched products
    for (const pid of touchedProductIds) {
      await this.updateProductRating(pid);
    }

    const populated = await Review.find({
      _id: { $in: resultReviews.map((r) => r._id) },
    })
      .populate({
        path: "userId",
        select: "fullName avatar",
      })
      .populate({
        path: "productId",
        select: "name slug images",
      })
      .sort({ createdAt: -1 });

    return populated;
  }

  /**
   * Get reviews for a product
   */
  async getProductReviews(productId, filters = {}, userId = null) {
    const { page = 1, limit = 10, rating = null, sortBy = "recent" } = filters;

    const query = {
      productId,
      status: "approved",
    };

    if (rating) {
      query.rating = rating;
    }

    let sortOption = { createdAt: -1 };
    switch (sortBy) {
      case "helpful":
        sortOption = { helpful: -1 };
        break;
      case "rating_high":
        sortOption = { rating: -1 };
        break;
      case "rating_low":
        sortOption = { rating: 1 };
        break;
      case "recent":
      default:
        sortOption = { createdAt: -1 };
    }

    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate({
          path: "userId",
          select: "fullName avatar",
        })
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    const shapedReviews = reviews.map((review) => {
      const result = { ...review };

      if (userId) {
        const uid = userId.toString();
        const helpfulBy = Array.isArray(review.helpfulBy)
          ? review.helpfulBy
          : [];
        const unhelpfulBy = Array.isArray(review.unhelpfulBy)
          ? review.unhelpfulBy
          : [];

        if (helpfulBy.some((id) => id.toString() === uid)) {
          result.userReaction = "helpful";
        } else if (unhelpfulBy.some((id) => id.toString() === uid)) {
          result.userReaction = "unhelpful";
        } else {
          result.userReaction = "none";
        }
      } else {
        result.userReaction = "none";
      }

      delete result.helpfulBy;
      delete result.unhelpfulBy;
      return result;
    });

    return {
      data: shapedReviews,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: shapedReviews.length,
        total_count: total,
      },
    };
  }

  /**
   * Get user's reviews
   */
  async getUserReviews(userId, filters = {}) {
    const { page = 1, limit = 10 } = filters;
    const skip = (page - 1) * limit;

    const query = { userId };

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate({
          path: "productId",
          select: "name slug images",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    return {
      data: reviews,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: reviews.length,
        total_count: total,
      },
    };
  }

  /**
   * Get single review
   */
  async getReview(reviewId) {
    const review = await Review.findById(reviewId)
      .populate({
        path: "userId",
        select: "fullName avatar email",
      })
      .populate({
        path: "productId",
        select: "name slug images rating reviewCount",
      });

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    return review;
  }

  /**
   * Update review
   */
  async updateReview(reviewId, userId, updateData) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    // Check if user is review owner
    if (review.userId.toString() !== userId.toString()) {
      throw new ErrorResponse(
        "You are not authorized to update this review",
        403,
      );
    }

    // Update fields
    if (updateData.rating) review.rating = updateData.rating;
    if (updateData.title !== undefined) review.title = updateData.title;
    if (updateData.content) review.content = updateData.content;
    if (updateData.images) review.images = updateData.images;

    await review.save();

    // Update product rating if rating changed
    if (updateData.rating) {
      await this.updateProductRating(review.productId);
    }

    return review;
  }

  /**
   * Delete review
   */
  async deleteReview(reviewId, userId) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    // Check if user is review owner
    if (review.userId.toString() !== userId.toString()) {
      throw new ErrorResponse(
        "You are not authorized to delete this review",
        403,
      );
    }

    const productId = review.productId;
    await Review.findByIdAndDelete(reviewId);

    // Update product rating
    await this.updateProductRating(productId);

    return { message: "Review deleted successfully" };
  }

  /**
   * Update product rating (calculate average and count)
   */
  async updateProductRating(productId) {
    const product = await Product.findById(productId).select("_id sellerId");
    if (!product) {
      return;
    }

    const reviews = await Review.find({
      productId,
      status: "approved",
    });

    if (reviews.length === 0) {
      // No approved reviews
      await Product.findByIdAndUpdate(productId, {
        rating: 0,
        reviewCount: 0,
      });
    } else {
      // Calculate average rating
      const totalRating = reviews.reduce((sum, review) => sum + review.rating, 0);
      const averageRating = (totalRating / reviews.length).toFixed(1);
      const reviewCount = reviews.length;

      console.log(
        `Updating product ${productId}: rating=${averageRating}, reviewCount=${reviewCount}`,
      );

      await Product.findByIdAndUpdate(productId, {
        rating: parseFloat(averageRating),
        reviewCount,
      });
    }

    await updateShopRatingForSeller(product.sellerId);
  }

  /**
   * Mark review as helpful
   */
  async markHelpful(reviewId, userId) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    const userIdStr = userId.toString();
    const helpfulByIndex = review.helpfulBy
      .map((id) => id.toString())
      .indexOf(userIdStr);
    const unhelpfulByIndex = review.unhelpfulBy
      .map((id) => id.toString())
      .indexOf(userIdStr);

    if (helpfulByIndex !== -1) {
      // User already marked helpful, toggle off
      review.helpfulBy.splice(helpfulByIndex, 1);
      review.helpful = Math.max(0, review.helpful - 1);
    } else {
      // User marking helpful
      review.helpfulBy.push(userId);
      review.helpful = (review.helpful || 0) + 1;

      // If user had marked unhelpful, remove it
      if (unhelpfulByIndex !== -1) {
        review.unhelpfulBy.splice(unhelpfulByIndex, 1);
        review.unhelpful = Math.max(0, review.unhelpful - 1);
      }
    }

    await review.save();
    return review;
  }

  /**
   * Mark review as unhelpful
   */
  async markUnhelpful(reviewId, userId) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    const userIdStr = userId.toString();
    const helpfulByIndex = review.helpfulBy
      .map((id) => id.toString())
      .indexOf(userIdStr);
    const unhelpfulByIndex = review.unhelpfulBy
      .map((id) => id.toString())
      .indexOf(userIdStr);

    if (unhelpfulByIndex !== -1) {
      // User already marked unhelpful, toggle off
      review.unhelpfulBy.splice(unhelpfulByIndex, 1);
      review.unhelpful = Math.max(0, review.unhelpful - 1);
    } else {
      // User marking unhelpful
      review.unhelpfulBy.push(userId);
      review.unhelpful = (review.unhelpful || 0) + 1;

      // If user had marked helpful, remove it
      if (helpfulByIndex !== -1) {
        review.helpfulBy.splice(helpfulByIndex, 1);
        review.helpful = Math.max(0, review.helpful - 1);
      }
    }

    await review.save();
    return review;
  }

  /**
   * Get review statistics for a product
   */
  async getProductReviewStats(productId) {
    const product =
      await Product.findById(productId).select("rating reviewCount");

    if (!product) {
      throw new ErrorResponse("Product not found", 404);
    }

    // Get rating distribution
    const ratingDistribution = await Review.aggregate([
      {
        $match: {
          productId: new mongoose.Types.ObjectId(productId),
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: -1 },
      },
    ]);

    return {
      averageRating: product.rating,
      totalReviews: product.reviewCount,
      ratingDistribution: ratingDistribution.map((item) => ({
        stars: item._id,
        count: item.count,
      })),
    };
  }
}

export default new ReviewService();
