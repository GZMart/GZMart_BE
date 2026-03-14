import express from "express";
import {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  logout,
  verifyEmail,
  resendVerification,
  refreshToken,
  loginWithGoogle,
  loginWithFacebook,
  setPassword,
  sendOTP,
  verifyOTP,
} from "../controllers/auth.controller.js";
import { protect, optionalAuth } from "../middlewares/auth.middleware.js";
import {
  requireBuyer,
  requireSeller,
  requireAdmin,
} from "../middlewares/role.middleware.js";

import upload from "../middlewares/upload.middleware.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               fullName:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [buyer, seller]
 *     responses:
 *       201:
 *         description: Success
 */
router.post("/register", register);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/login", login);

/**
 * @swagger
 * /api/auth/verify-email:
 *   get:
 *     tags: [Authentication]
 *     summary: Verify user email
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/verify-email", verifyEmail);

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     tags: [Authentication]
 *     summary: Resend verification email
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/resend-verification", resendVerification);

/**
 * @swagger
 * /api/auth/send-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Send OTP to email
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/send-otp", sendOTP);

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify OTP
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/verify-otp", verifyOTP);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request password reset
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/forgot-password", forgotPassword);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Reset password with token
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/reset-password", resetPassword);

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Authentication]
 *     summary: Refresh access token
 *     responses:
 *       200:
 *         description: Success
 */
router.post("/refresh-token", refreshToken);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: Get current user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/me", protect, getMe);

/**
 * @swagger
 * /api/auth/update-profile:
 *   put:
 *     tags: [Authentication]
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
router.put(
  "/update-profile",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "profileImage", maxCount: 1 },
  ]),
  updateProfile,
);

/**
 * @route   PUT /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.put("/change-password", protect, changePassword);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post("/logout", protect, logout);
router.post("/google-login", loginWithGoogle);
router.post("/facebook-login", loginWithFacebook);
router.post("/set-password", protect, setPassword);

export default router;
