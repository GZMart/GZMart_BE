import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/** Tránh ReDoS khi ghép chuỗi user vào regex */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class UserService {
  /**
   * Get all users with pagination and filtering
   */
  async getAllUsers({ page = 1, limit = 10, search, role, status, isActive }) {
    const query = {};

    // Search by name or email
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by role
    if (role) {
      query.role = role;
    }

    // Filter by status (keep for backward compatibility)
    if (status !== undefined) {
      query.status = status === "true" || status === true;
    }

    // Filter by isActive (ban status)
    if (isActive !== undefined) {
      query.isActive = isActive === "true" || isActive === true;
    }

    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    return {
      users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalUsers: total,
        limit,
      },
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(userId) {
    const user = await User.findById(userId).select("-password").lean();

    if (!user) {
      throw new ErrorResponse("User not found", 404);
    }

    return user;
  }

  /**
   * Toggle user ban status (isActive)
   */
  async toggleUserStatus(userId) {
    const user = await User.findById(userId);

    if (!user) {
      throw new ErrorResponse("User not found", 404);
    }

    // Toggle isActive field
    user.isActive = !user.isActive;
    await user.save();

    // Return user without password
    const updatedUser = await User.findById(userId).select("-password").lean();

    return updatedUser;
  }

  /**
   * Admin: gợi ý seller khi lọc (tên shop, email, họ tên, SĐT).
   */
  async searchSellersForAdmin({ q = "", limit = 20 } = {}) {
    const max = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const trimmed = (q || "").trim();
    if (!trimmed) {
      return [];
    }

    const base = { role: "seller" };

    if (/^[a-fA-F0-9]{24}$/.test(trimmed)) {
      const byId = await User.findOne({ ...base, _id: trimmed })
        .select("shopName fullName email phone")
        .lean();
      if (byId) {
        return [byId];
      }
    }

    if (trimmed.length < 2) {
      return [];
    }

    const rx = escapeRegex(trimmed);
    const or = [
      { fullName: { $regex: rx, $options: "i" } },
      { email: { $regex: rx, $options: "i" } },
      { shopName: { $regex: rx, $options: "i" } },
      { phone: { $regex: rx, $options: "i" } },
    ];

    return User.find({ ...base, $or: or })
      .select("shopName fullName email phone")
      .sort({ shopName: 1, fullName: 1 })
      .limit(max)
      .lean();
  }
}

export default new UserService();
