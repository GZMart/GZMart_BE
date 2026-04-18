import mongoose from "mongoose";
import Review from "../models/Review.js";
import Product from "../models/Product.js";
import ShopStatistic from "../models/ShopStatistic.js";

/**
 * Cập nhật rating shop = trung bình tất cả review (approved) của mọi sản phẩm thuộc seller.
 */
export async function updateShopRatingForSeller(sellerId) {
  if (!sellerId) return;

  const oid =
    sellerId instanceof mongoose.Types.ObjectId
      ? sellerId
      : new mongoose.Types.ObjectId(sellerId);

  const result = await Review.aggregate([
    { $match: { status: "approved" } },
    {
      $lookup: {
        from: Product.collection.name,
        localField: "productId",
        foreignField: "_id",
        as: "p",
      },
    },
    { $unwind: "$p" },
    { $match: { "p.sellerId": oid } },
    {
      $group: {
        _id: null,
        ratingAverage: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  const stat = result[0];
  const roundedRating = stat
    ? Math.round(stat.ratingAverage * 10) / 10
    : 0;
  const count = stat ? stat.ratingCount : 0;

  await ShopStatistic.findOneAndUpdate(
    { sellerId: oid },
    { $set: { ratingAverage: roundedRating, ratingCount: count } },
    { upsert: true, new: true },
  );
}

/**
 * Tính lại toàn bộ shop (cron / migration). Cùng công thức với updateShopRatingForSeller.
 */
export async function recalculateAllShopRatings() {
  const sellerStats = await Review.aggregate([
    { $match: { status: "approved" } },
    {
      $lookup: {
        from: Product.collection.name,
        localField: "productId",
        foreignField: "_id",
        as: "p",
      },
    },
    { $unwind: "$p" },
    {
      $group: {
        _id: "$p.sellerId",
        ratingAverage: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  for (const stat of sellerStats) {
    const sellerId = stat._id;
    if (!sellerId) continue;

    const roundedRating = Math.round(stat.ratingAverage * 10) / 10;

    await ShopStatistic.findOneAndUpdate(
      { sellerId },
      {
        $set: {
          ratingAverage: roundedRating,
          ratingCount: stat.ratingCount,
        },
      },
      { new: true, upsert: true },
    );
  }

  const allShopStats = await ShopStatistic.find({});
  for (const shop of allShopStats) {
    const hasReviews = sellerStats.find(
      (s) =>
        s._id &&
        shop.sellerId &&
        s._id.toString() === shop.sellerId.toString(),
    );
    if (!hasReviews) {
      shop.ratingAverage = 0;
      shop.ratingCount = 0;
      await shop.save();
    }
  }
}
