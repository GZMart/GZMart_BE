import mongoose from "mongoose";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import { ErrorResponse } from "../utils/errorResponse.js";

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

    // Check if user has already reviewed this product in this order (or non-order review)
    const existingReview = await Review.findOne({
      productId,
      userId,
      orderId: orderId || null,
    });

    if (existingReview) {
      throw new ErrorResponse("You have already reviewed this product", 400);
    }

    // If orderId provided, verify user purchased this product
    let verifiedPurchase = false;
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        userId,
      }).populate({
        path: "items",
        select: "productId",
      });

      if (!order) {
        throw new ErrorResponse(
          "Order not found or does not belong to you",
          404,
        );
      }

      // Check if any item in the order has the requested productId
      const hasProduct = order.items.some(
        (item) => item.productId.toString() === productId.toString(),
      );

      if (!hasProduct) {
        throw new ErrorResponse(
          "You did not purchase this product in this order",
          403,
        );
      }
      verifiedPurchase = true;
    }

    let review;
    try {
      // Create review
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
        status: "approved", // Default to approved
      });
    } catch (error) {
      // Backward-compatibility fallback for legacy unique index {productId, userId}
      if (error?.code === 11000) {
        review = await Review.findOne({ productId, userId });
        if (!review) {
          throw new ErrorResponse("Duplicate field value entered", 400);
        }

        review.orderId = orderId || review.orderId || null;
        review.rating = reviewData.rating;
        review.title = reviewData.title || null;
        review.content = reviewData.content;
        review.variant = reviewData.variant || null;
        review.images = reviewData.images || [];
        review.verifiedPurchase = verifiedPurchase;
        review.status = "approved";
        review.helpful = 0;
        review.unhelpful = 0;
        review.helpfulBy = [];
        review.unhelpfulBy = [];
        await review.save();
      } else {
        throw error;
      }
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
   * Create or update reviews for all products in an order with same review content.
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

      // Ensure product still exists
      const product = await Product.findById(productId).select("_id");
      if (!product) {
        continue;
      }

      let review = await Review.findOne({ userId, orderId, productId });

      if (review) {
        // Replace old review content with new one (edit behavior)
        review.rating = reviewData.rating;
        review.title = reviewData.title || null;
        review.content = reviewData.content;
        review.images = reviewData.images || [];
        review.variant = variantLabel || reviewData.variant || null;
        review.verifiedPurchase = true;
        review.status = "approved";
        await review.save();
      } else {
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
          // Backward-compatibility fallback for legacy unique index {productId, userId}
          if (error?.code === 11000) {
            review = await Review.findOne({ productId, userId });
            if (!review) {
              throw new ErrorResponse("Duplicate field value entered", 400);
            }

            review.orderId = orderId;
            review.rating = reviewData.rating;
            review.title = reviewData.title || null;
            review.content = reviewData.content;
            review.images = reviewData.images || [];
            review.variant = variantLabel || reviewData.variant || null;
            review.verifiedPurchase = true;
            review.status = "approved";
            review.helpful = 0;
            review.unhelpful = 0;
            review.helpfulBy = [];
            review.unhelpfulBy = [];
            await review.save();
          } else {
            throw error;
          }
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
      return;
    }

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

  /**
   * Mark review as helpful
   */
  async markHelpful(reviewId, userId) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    const uid = userId.toString();
    const alreadyHelpful = review.helpfulBy.some((id) => id.toString() === uid);
    const alreadyUnhelpful = review.unhelpfulBy.some(
      (id) => id.toString() === uid,
    );

    // Toggle off if user clicks helpful again
    if (alreadyHelpful) {
      review.helpfulBy = review.helpfulBy.filter((id) => id.toString() !== uid);
      review.helpful = Math.max(0, (review.helpful || 0) - 1);
      await review.save();
      const payload = review.toObject();
      payload.userReaction = "none";
      delete payload.helpfulBy;
      delete payload.unhelpfulBy;
      return payload;
    }

    // Move reaction from unhelpful -> helpful if needed
    if (alreadyUnhelpful) {
      review.unhelpfulBy = review.unhelpfulBy.filter(
        (id) => id.toString() !== uid,
      );
      review.unhelpful = Math.max(0, (review.unhelpful || 0) - 1);
    }

    review.helpfulBy.push(userId);
    review.helpful = (review.helpful || 0) + 1;
    await review.save();
    const payload = review.toObject();
    payload.userReaction = "helpful";
    delete payload.helpfulBy;
    delete payload.unhelpfulBy;
    return payload;
  }

  /**
   * Mark review as unhelpful
   */
  async markUnhelpful(reviewId, userId) {
    const review = await Review.findById(reviewId);

    if (!review) {
      throw new ErrorResponse("Review not found", 404);
    }

    const uid = userId.toString();
    const alreadyUnhelpful = review.unhelpfulBy.some(
      (id) => id.toString() === uid,
    );
    const alreadyHelpful = review.helpfulBy.some((id) => id.toString() === uid);

    // Toggle off if user clicks unhelpful again
    if (alreadyUnhelpful) {
      review.unhelpfulBy = review.unhelpfulBy.filter(
        (id) => id.toString() !== uid,
      );
      review.unhelpful = Math.max(0, (review.unhelpful || 0) - 1);
      await review.save();
      const payload = review.toObject();
      payload.userReaction = "none";
      delete payload.helpfulBy;
      delete payload.unhelpfulBy;
      return payload;
    }

    // Move reaction from helpful -> unhelpful if needed
    if (alreadyHelpful) {
      review.helpfulBy = review.helpfulBy.filter((id) => id.toString() !== uid);
      review.helpful = Math.max(0, (review.helpful || 0) - 1);
    }

    review.unhelpfulBy.push(userId);
    review.unhelpful = (review.unhelpful || 0) + 1;
    await review.save();
    const payload = review.toObject();
    payload.userReaction = "unhelpful";
    delete payload.helpfulBy;
    delete payload.unhelpfulBy;
    return payload;
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
