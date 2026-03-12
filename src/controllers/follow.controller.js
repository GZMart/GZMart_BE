import Follow from "../models/Follow.js";
import User from "../models/User.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Toggle follow status for a shop
 * @route   POST /api/follows/:shopId
 * @access  Private
 */
export const toggleFollow = asyncHandler(async (req, res, next) => {
  const followerId = req.user._id;
  const followingId = req.params.shopId;

  if (followerId.toString() === followingId.toString()) {
    return next(new ErrorResponse("You cannot follow yourself", 400));
  }

  // Ensure the shop exists
  const shop = await User.findById(followingId);
  if (!shop) {
    return next(new ErrorResponse("Shop not found", 404));
  }

  const existingFollow = await Follow.findOne({ followerId, followingId });

  if (existingFollow) {
    // Unfollow
    await existingFollow.deleteOne();
    return res.status(200).json({
      success: true,
      message: "Unfollowed successfully",
      data: { isFollowing: false },
    });
  } else {
    // Follow
    await Follow.create({ followerId, followingId });
    return res.status(201).json({
      success: true,
      message: "Followed successfully",
      data: { isFollowing: true },
    });
  }
});

/**
 * @desc    Check follow status for a shop
 * @route   GET /api/follows/:shopId/status
 * @access  Private
 */
export const checkFollowStatus = asyncHandler(async (req, res, next) => {
  const followerId = req.user._id;
  const followingId = req.params.shopId;

  const existingFollow = await Follow.findOne({ followerId, followingId });

  res.status(200).json({
    success: true,
    data: { isFollowing: !!existingFollow },
  });
});
