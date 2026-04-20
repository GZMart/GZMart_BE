import userService from "../services/user.service.js";

/**
 * Get all users (Admin only)
 */
export const getAllUsers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, role, status } = req.query;

    const users = await userService.getAllUsers({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      role,
      status,
    });

    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user by ID (Admin only)
 */
export const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Toggle user ban status (Admin only)
 */
export const toggleUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await userService.toggleUserStatus(id);

    const actionMessage = user.isActive ? "unbanned" : "banned";

    res.status(200).json({
      success: true,
      message: `User ${actionMessage} successfully`,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: tìm seller (autocomplete) — shop, email, tên, SĐT
 */
export const searchSellers = async (req, res, next) => {
  try {
    const { q, limit } = req.query;
    const data = await userService.searchSellersForAdmin({ q, limit });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};
