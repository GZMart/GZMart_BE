import Product from "../models/Product.js";
import OrderItem from "../models/OrderItem.js";
import ViewHistory from "../models/ViewHistory.js";
import redisService from "./redis.service.js";
import { getTodayRecommendations } from "./product.service.js";
import mongoose from "mongoose";

class RecommendationService {
  /**
   * Tính trung bình vector (Centroid) của một mảng các vectors.
   */
  _calculateCentroid(embeddings) {
    if (!embeddings || embeddings.length === 0) return null;
    const dimensions = embeddings[0].length;
    const centroid = new Array(dimensions).fill(0);

    for (const emb of embeddings) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += emb[i];
      }
    }

    return centroid.map((val) => val / embeddings.length);
  }

  /**
   * 1. Content-Based Filtering
   * Dùng Vector Search (Cosine Similarity trên MongoDB Atlas)
   * dựa trên trung bình vector của các sản phẩm User đã tương tác.
   */
  async _getContentBasedRecs(userId, limit = 10) {
    try {
      // Lấy 5 sản phẩm tương tác gần nhất (ưu tiên mua, sau đó là xem)
      const recentOrders = await OrderItem.find({ buyerId: userId })
        .sort({ createdAt: -1 })
        .limit(3)
        .select("productId")
        .lean();

      const recentViews = await ViewHistory.find({ userId })
        .sort({ lastViewedAt: -1 })
        .limit(5)
        .select("productId")
        .lean();

      const productIds = [
        ...recentOrders.map((o) => o.productId),
        ...recentViews.map((v) => v.productId),
      ];

      // Lọc trùng
      const uniqueIds = [...new Set(productIds.map((id) => id.toString()))].map(
        (id) => new mongoose.Types.ObjectId(id)
      );

      if (uniqueIds.length === 0) return [];

      // Lấy embeddings của các sản phẩm này
      const products = await Product.find({
        _id: { $in: uniqueIds },
        status: "active",
      })
        .select("+embedding")
        .lean();

      const embeddings = products
        .filter((p) => p.embedding && p.embedding.length > 0)
        .map((p) => p.embedding);

      if (embeddings.length === 0) return [];

      const centroidVector = this._calculateCentroid(embeddings);

      // Atlas Vector Search: filter chỉ được dùng các trường đã khai báo filter trong index Atlas.
      // _id trong filter gây lỗi "Path '_id' needs to be indexed as filter" — lọc _id ở $match sau.
      const vectorResults = await Product.aggregate([
        {
          $vectorSearch: {
            index: "product_vector_index",
            path: "embedding",
            queryVector: centroidVector,
            numCandidates: 100,
            limit: limit * 3,
            filter: { status: "active" },
          },
        },
        { $match: { _id: { $nin: uniqueIds } } },
        {
          $addFields: { score: { $meta: "vectorSearchScore" } },
        },
        {
          $project: {
            name: 1,
            slug: 1,
            categoryId: 1,
            sellerId: 1,
            originalPrice: 1,
            rating: 1,
            reviewCount: 1,
            sold: 1,
            brand: 1,
            "models.price": 1,
            "models.stock": 1,
            images: 1,
            score: 1,
          },
        },
      ]);

      return vectorResults.map(p => ({ ...p, recSource: 'content', weight: p.score * 0.4 }));
    } catch (error) {
      console.error("[RecommendationService] Content-Based Error:", error);
      return [];
    }
  }

  /**
   * 2. Collaborative Filtering (Item-Based Co-occurrence)
   * Tìm những người dùng khác cũng xem/mua sản phẩm giống User hiện tại,
   * sau đó xem họ mua gì thêm.
   */
  async _getCollaborativeRecs(userId, limit = 10) {
    try {
      // 1. Tìm các sản phẩm user đã tương tác
      const userViews = await ViewHistory.find({ userId })
        .sort({ lastViewedAt: -1 })
        .limit(10)
        .select("productId")
        .lean();
      
      const userProductIds = userViews.map(v => v.productId);

      if (userProductIds.length === 0) return [];

      // 2. Tìm những User khác đã XEM các sản phẩm này
      const similarUsers = await ViewHistory.aggregate([
        { $match: { productId: { $in: userProductIds }, userId: { $ne: new mongoose.Types.ObjectId(userId) } } },
        { $group: { _id: "$userId", commonCount: { $sum: 1 } } },
        { $sort: { commonCount: -1 } },
        { $limit: 10 } // Top 10 similar users
      ]);

      const similarUserIds = similarUsers.map(u => u._id);
      if (similarUserIds.length === 0) return [];

      // 3. Tìm các sản phẩm mà những User kia xem nhiều nhất, loại trừ sản phẩm User hiện tại đã xem
      const collabProducts = await ViewHistory.aggregate([
        { $match: { userId: { $in: similarUserIds }, productId: { $nin: userProductIds } } },
        { $group: { _id: "$productId", score: { $sum: "$viewCount" } } },
        { $sort: { score: -1 } },
        { $limit: limit * 2 }
      ]);

      const collabProductIds = collabProducts.map(p => p._id);

      if (collabProductIds.length === 0) return [];

      // Fetch product details
      const products = await Product.find({ _id: { $in: collabProductIds }, status: "active" })
        .populate("categoryId", "name slug")
        .select("name slug categoryId sellerId originalPrice rating reviewCount sold brand models images")
        .lean();

      // Normalize score to 0-1 range for weighting
      const maxScore = collabProducts[0]?.score || 1;

      return products.map(p => {
        const cp = collabProducts.find(c => c._id.toString() === p._id.toString());
        const rawScore = cp ? cp.score / maxScore : 0.1;
        return { ...p, recSource: 'collab', weight: rawScore * 0.6 }; // 60% weight for Collab
      });

    } catch (error) {
      console.error("[RecommendationService] Collaborative Error:", error);
      return [];
    }
  }

  /**
   * Main Hybrid Engine Entrypoint
   */
  async getPersonalizedRecommendations(userId, limit = 16) {
    // 1. Check Cache
    const cacheKey = `recs:hybrid:${userId}`;
    if (redisService.isAvailable()) {
      const cached = await redisService.get(cacheKey);
      if (cached) return cached;
    }

    // 2. Fetch both strategies concurrently
    const [contentRecs, collabRecs] = await Promise.all([
      this._getContentBasedRecs(userId, limit),
      this._getCollaborativeRecs(userId, limit)
    ]);

    // 3. Merge & Deduplicate
    const combinedMap = new Map();

    const mergeItem = (item) => {
      const idStr = item._id.toString();
      if (combinedMap.has(idStr)) {
        const existing = combinedMap.get(idStr);
        // Combine weights if found in both
        existing.weight += item.weight;
        existing.recSource = 'hybrid';
      } else {
        combinedMap.set(idStr, item);
      }
    };

    contentRecs.forEach(mergeItem);
    collabRecs.forEach(mergeItem);

    // 4. Sort by combined weight
    let finalRecs = Array.from(combinedMap.values()).sort((a, b) => b.weight - a.weight);

    // 5. Fallback if not enough data (Cold Start)
    if (finalRecs.length < limit) {
      const trending = await getTodayRecommendations(limit - finalRecs.length);
      const trendingIds = new Set(finalRecs.map(r => r._id.toString()));
      
      for (const t of trending) {
        if (!trendingIds.has(t._id.toString())) {
           finalRecs.push({ ...t, recSource: 'trending', weight: 0 });
        }
      }
    }

    finalRecs = finalRecs.slice(0, limit);

    // Format fields similar to standard product response
    finalRecs = finalRecs.map(product => {
      const models = product.models || [];
      if (models.length > 0) {
        const prices = models.map((m) => m.price);
        product.minPrice = Math.min(...prices);
        product.maxPrice = Math.max(...prices);
        product.price = product.minPrice;
        product.totalStock = models.reduce((sum, m) => sum + m.stock, 0);
      } else if (!product.price) {
        product.price = product.originalPrice || 0;
      }
      return product;
    });

    // 6. Set Cache (TTL 1 hour)
    if (redisService.isAvailable()) {
      await redisService.set(cacheKey, finalRecs, 3600);
    }

    return finalRecs;
  }
}

export default new RecommendationService();
