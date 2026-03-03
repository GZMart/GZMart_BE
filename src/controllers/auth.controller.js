import User from '../models/User.js';
import TokenBlacklist from '../models/TokenBlacklist.js';
import { asyncHandler } from '../middlewares/async.middleware.js';
import { ErrorResponse } from '../utils/errorResponse.js';
import jwt from 'jsonwebtoken';
import { sendTemplatedEmail } from '../utils/sendEmail.js';
import logger from '../utils/logger.js';
import { generateToken } from '../utils/jwt.js';

// OTP Store: Map<email, { otp: string, expiresAt: Date, attempts: number }>
const otpStore = new Map();

/**
 * Generate 4-digit OTP
 * @returns {string} 4-digit OTP code
 */
const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
};

/**
 * Clean expired OTPs from store
 */
const cleanExpiredOTPs = () => {
  const now = Date.now();
  for (const [email, data] of otpStore.entries()) {
    if (data.expiresAt < now) {
      otpStore.delete(email);
    }
  }
};

/**
 REGISTER
 */
export const register = async (req, res, next) => {
  try {
    const { fullName, email, password } = req.body;

    // Check required fields - chỉ cần 3 trường
    if (!fullName || !email || !password) {
      return next(
        new ErrorResponse(
          'Please provide full name, email and password',
          400
        )
      );
    }

    // Check if user exists
    let user = await User.findOne({ email });

    if (user) {
      if (user.isVerified) {
        return next(new ErrorResponse('User already exists', 400));
      }
      
      // Update existing unverified user
      user.fullName = fullName;
      user.password = password;
      
      const token = generateToken({ email }, process.env.JWT_VERIFY_EXPIRES_IN || '1h');
      user.verificationToken = token;
      user.verificationTokenExpires = new Date(Date.now() + 3600000); 

      if (req.body.phone && /^[0-9]{10,11}$/.test(req.body.phone)) {
        user.phone = req.body.phone;
      }
      if (req.body.address) {
        user.address = req.body.address;
      }

      await user.save();
    } else {
      // Create new user
      const token = generateToken({ email }, process.env.JWT_VERIFY_EXPIRES_IN || '1h');
      
      const userData = {
        fullName,
        email,
        password,
        role: 'buyer',
        isVerified: false,
        verificationToken: token,
        verificationTokenExpires: new Date(Date.now() + 3600000), 
      };

      if (req.body.phone && /^[0-9]{10,11}$/.test(req.body.phone)) {
        userData.phone = req.body.phone;
      }
      if (req.body.address) {
        userData.address = req.body.address;
      }

      try {
        user = await User.create(userData);
      } catch (error) {
         if (error.name === 'ValidationError') {
          const messages = Object.values(error.errors).map(err => err.message).join(', ');
          logger.error('User validation error:', { error: messages, userData });
          return next(new ErrorResponse(messages, 400));
        }
        if (error.code === 11000) {
           const field = Object.keys(error.keyPattern)[0];
           logger.error('Duplicate key error:', { field, userData });
           return next(new ErrorResponse(`${field} already exists`, 400));
        }
        throw error;
      }
    }

    // Send OTP for email verification (non-blocking - don't fail registration if email fails)
    try {
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      // Store OTP
      otpStore.set(user.email, {
        otp,
        expiresAt,
        attempts: 0,
      });

      // Always log OTP in development (before trying to send email)
      if (process.env.NODE_ENV !== 'production') {
        console.log('\n========================================');
        console.log(`📧 REGISTRATION OTP for ${user.email}`);
        console.log(`🔐 OTP Code: ${otp}`);
        console.log(`⏰ Expires in: 5 minutes`);
        console.log('========================================\n');
      }

      try {
        await sendTemplatedEmail({
          email: user.email,
          templateType: 'OTP',
          templateData: {
            name: user.fullName,
            otp,
            expiresIn: '5 minutes',
          },
        });
        logger.info('OTP sent successfully for registration', { userId: user._id, email: user.email });
      } catch (emailError) {
        // Log error but don't fail registration
        logger.error('Failed to send OTP email', {
          error: emailError.message,
          userId: user._id,
          email: user.email,
        });
        // In development, OTP is already logged above
        if (process.env.NODE_ENV !== 'production') {
          logger.warn('Email service not configured. OTP is logged in console above.');
        }
      }
    } catch (otpError) {
      // If OTP generation/store fails, log but don't fail registration
      logger.error('Failed to generate/store OTP', {
        error: otpError.message,
        userId: user._id,
        email: user.email,
      });
    }

    // Remove sensitive data from response
    user.password = undefined;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;

    logger.info('User registered successfully, OTP sent', { userId: user._id, email: user.email });

    // Get OTP for development mode (to return in response)
    const storedOTP = otpStore.get(user.email);
    const responseData = {
      success: true,
      message: 'Registration successful. Please check your email for OTP verification code.',
      data: {
        user: {
          _id: user._id,
          email: user.email,
          fullName: user.fullName,
          isVerified: user.isVerified,
        },
      },
    };

    // In development, include OTP in response for testing
    if (process.env.NODE_ENV !== 'production' && storedOTP) {
      responseData.data.otp = storedOTP.otp; // Only in development
      responseData.message += ' (Check console or response for OTP in development)';
    }

    // Don't return tokens yet - user needs to verify OTP first
    res.status(201).json(responseData);
  } catch (error) {
    logger.error('Error in register controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};


/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with user data and tokens
 */
export const login = async (req, res, next) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      return next(new ErrorResponse('Please provide email and password', 400));
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return next(
        new ErrorResponse(
          'Email not found. Please check your email or register a new account.',
          401
        )
      );
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return next(
        new ErrorResponse(
          "Incorrect password. Please try again or use 'Forgot Password' if you don't remember.",
          401
        )
      );
    }

    if (!user.isVerified) {
      return next(
        new ErrorResponse(
          'Please verify your email before logging in. Check your inbox for the verification link.',
          401
        )
      );
    }

    if (!user.status) {
      return next(
        new ErrorResponse(
          'Your account has been deactivated. Please contact support for assistance.',
          401
        )
      );
    }

    // Generate tokens with different expiration based on rememberMe
    const accessTokenExpiry = rememberMe ? '30d' : process.env.JWT_EXPIRES_IN || '1d';
    const refreshTokenExpiry = rememberMe ? '90d' : process.env.JWT_REFRESH_EXPIRES_IN || '7d';

    const accessToken = generateToken({ id: user._id }, accessTokenExpiry);
    const refreshToken = generateToken({ id: user._id }, refreshTokenExpiry);

    user.password = undefined;

    logger.info('User logged in successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    logger.error('Error in login controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Create tokens
 * @route   POST /api/auth/create-tokens
 * @access  Private
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} Response with success message
 */
const createTokens = (userId, rememberMe = false) => {
  const accessTokenExpiry = rememberMe ? '30d' : '1h';
  const refreshTokenExpiry = rememberMe ? '90d' : '7d';

  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: accessTokenExpiry,
  });
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: refreshTokenExpiry,
  });
  return { token, refreshToken };
};

/**
 * @desc    Login with Google
 * @route   POST /api/auth/login-with-google
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} Response with success message
 */
export const loginWithGoogle = async (req, res) => {
  try {
    const { email, name, picture, rememberMe } = req.body;
    console.log('Google login data received:', { email, name, picture, rememberMe }); // Debug log

    if (!email) return res.status(400).json({ message: 'Missing email from Google' });

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const fakePassword = Math.random().toString(36).slice(-8);

      user = new User({
        fullName: name || 'Google User',
        email,
        password: fakePassword,
        avatar: picture || '', // Ensure avatar is set
        isVerified: true,
        role: 'buyer',
        address: '',
        phone: '',
        reward_point: 0,
        gender: 'other',
      });
      await user.save();
      console.log('New Google user created:', { avatar: user.avatar, picture });
    } else {
      const DEFAULT_AVATAR = 'https://static.vecteezy.com/system/resources/previews/019/896/008/original/male-user-avatar-icon-in-flat-design-style-person-signs-illustration-png.png';
      
      console.log('Google Login Check:', { 
        currentAvatar: user.avatar, 
        googlePicture: picture,
        isDefault: user.avatar === DEFAULT_AVATAR 
      });

      // Update if no avatar OR if it's currently the default one
      if (picture && (!user.avatar || user.avatar === DEFAULT_AVATAR)) {
        user.avatar = picture;
        await user.save();
        console.log('Google user avatar updated (was empty or default).');
      } else {
        console.log('Skipping avatar update (custom avatar exists).');
      }
    }

    const { token, refreshToken } = createTokens(user._id, rememberMe);
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.__v;

    res.status(200).json({
      success: true,
      message: isNewUser
        ? 'Create account & login Google successfully'
        : 'Login Google successfully',
      user: userObj,
      token,
      refreshToken,
      isNewUser,
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ success: false, message: 'Login Google failed' });
  }
};

/**
 * @desc    Login with Facebook
 * @route   POST /api/auth/login-with-facebook
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} Response with success message
 */
export const loginWithFacebook = async (req, res) => {
  try {
    const { email, name, picture, rememberMe } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Missing email from Facebook' });
    }

    let user = await User.findOne({ email });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      const fakePassword = Math.random().toString(36).slice(-8);

      user = new User({
        fullName: name || 'Facebook User',
        email,
        password: fakePassword,
        avatar: picture,
        isVerified: true,
        role: 'buyer',
        address: '',
        phone: '',
        reward_point: 0,
        gender: 'other',
      });

      await user.save();
    } else {
      if (picture && !user.avatar) {
        user.avatar = picture;
        await user.save();
      }
    }

    const { token, refreshToken } = createTokens(user._id, rememberMe);
    const userObj = user.toObject();
    delete userObj.password;
    delete userObj.__v;

    return res.status(200).json({
      success: true,
      message: isNewUser
        ? 'Create account & login Facebook successfully'
        : 'Login Facebook successfully',
      user: userObj,
      token,
      refreshToken,
      isNewUser,
    });
  } catch (error) {
    console.error('Facebook login error:', error);
    return res.status(500).json({ success: false, message: 'Login Facebook failed' });
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/auth/me
 * @access  Private
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with user profile data
 */
export const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    logger.info('User profile retrieved successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error('Error in getMe controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/update-profile
 * @access  Private
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with updated user data
 */
export const updateProfile = async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      phone,
      address,
      provinceCode,
      provinceName,
      wardCode,
      wardName,
      dateOfBirth,
      gender,
      aboutMe,
    } = req.body;

    logger.info('Profile update - raw req.body:', {
      body: req.body,
      keys: Object.keys(req.body),
      hasFiles: !!req.files,
      files: req.files ? Object.keys(req.files) : [],
    });

    // Build update object
    const updateFields = {};
    if (fullName) updateFields.fullName = fullName;
    if (email) updateFields.email = email;
    if (phone) updateFields.phone = phone;
    if (address) updateFields.address = address;
    if (provinceCode) updateFields.provinceCode = provinceCode;
    if (provinceName) updateFields.provinceName = provinceName;
    if (wardCode) updateFields.wardCode = wardCode;
    if (wardName) updateFields.wardName = wardName;
    if (dateOfBirth) updateFields.dateOfBirth = dateOfBirth;
    if (gender) updateFields.gender = gender;
    if (aboutMe) updateFields.aboutMe = aboutMe;

    logger.info('Profile update - updateFields:', { updateFields });

    // Handle files from multer.fields
    if (req.files && req.files.avatar && req.files.avatar[0]) {
      updateFields.avatar = req.files.avatar[0].path;
    }
    if (req.files && req.files.profileImage && req.files.profileImage[0]) {
      updateFields.profileImage = req.files.profileImage[0].path;
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateFields },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    logger.info('User profile updated successfully', {
      userId: user._id,
      provinceCode: user.provinceCode,
      wardCode: user.wardCode,
      provinceName: user.provinceName,
      wardName: user.wardName,
    });

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    logger.error('Error in updateProfile controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Change user password
 * @route   PUT /api/auth/change-password
 * @access  Private
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    logger.info('Change password request', req.body);

    if (!currentPassword || !newPassword) {
      return next(new ErrorResponse('Please provide current password and new password', 400));
    }

    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Check current password
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return next(new ErrorResponse('Current password is incorrect', 400));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info('User password changed successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('Error in changePassword controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Forgot password
 * @route   POST /api/auth/forgot-password
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorResponse('Please provide an email', 400));
    }

    const user = await User.findOne({ email });

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Generate reset token
    const resetToken = generateToken({ id: user._id }, process.env.JWT_RESET_EXPIRES_IN || '1h');

    // Send reset email
    await sendTemplatedEmail({
      email: user.email,
      templateType: 'PASSWORD_RESET',
      templateData: {
        name: user.fullName,
        resetLink: `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`,
      },
    });

    logger.info('Password reset email sent successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password reset email sent',
    });
  } catch (error) {
    logger.error('Error in forgotPassword controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Reset password
 * @route   POST /api/auth/reset-password
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return next(new ErrorResponse('Please provide token and new password', 400));
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    console.log(user);
    console.log(newPassword);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    logger.info('Password reset successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    logger.error('Error in resetPassword controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

export const setPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = req.user;
    user.password = password;
    await user.save();

    res.status(200).json({ success: true, message: 'Set password successfully' });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({ message: 'Set password failed' });
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const logout = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    // Add token to blacklist
    await TokenBlacklist.create({
      token,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    });
  }

  res.status(200).json({
    success: true,
    data: {},
  });
});

/**
 * @desc    Verify email
 * @route   GET /api/auth/verify-email
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with verification result
 */
export const verifyEmail = async (req, res, next) => {
  try {
    // Get token from query params
    const token = req.query.token;

    if (!token) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/email-verification-failed?error=Verification token is required`
      );
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({
      email: decoded.email,
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/email-verification-failed?error=Invalid or expired verification token`
      );
    }

    // Update user
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    logger.info('Email verified successfully', { userId: user._id });

    // Redirect to success page
    return res.redirect(
      `${process.env.FRONTEND_URL}/email-verified?email=${encodeURIComponent(user.email)}`
    );
  } catch (error) {
    logger.error('Error in verifyEmail controller', {
      error: error.message,
      stack: error.stack,
    });
    return res.redirect(
      `${
        process.env.FRONTEND_URL
      }/email-verification-failed?error=${encodeURIComponent(error.message)}`
    );
  }
};

/**
 * @desc    Resend verification email
 * @route   POST /api/auth/resend-verification
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorResponse('Email is required', 400));
    }

    const user = await User.findOne({ email });

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    if (user.isVerified) {
      return next(new ErrorResponse('Email is already verified', 400));
    }

    // Generate new verification token
    const verificationToken = generateToken(
      { email: user.email },
      process.env.JWT_VERIFY_EXPIRES_IN || '1h'
    );

    // Update user
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    // Send verification email
    await sendTemplatedEmail({
      email: user.email,
      templateType: 'VERIFICATION',
      templateData: {
        name: user.fullName,
        verificationLink: `${
          process.env.FRONTEND_URL || 'http://localhost:5000'
        }/verify-email?token=${verificationToken}`,
      },
    });

    logger.info('Verification email resent successfully', { userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Verification email sent successfully',
    });
  } catch (error) {
    logger.error('Error in resendVerification controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with new access token
 */
export const refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new ErrorResponse('Refresh token is required', 400));
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE,
    });

    res.status(200).json({
      success: true,
      token,
    });
  } catch (err) {
    return next(new ErrorResponse('Invalid refresh token', 401));
  }
});

/**
 * @desc    Send OTP to email
 * @route   POST /api/auth/send-otp
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with success message
 */
export const sendOTP = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return next(new ErrorResponse('Email is required', 400));
    }

    // Clean expired OTPs
    cleanExpiredOTPs();

    // Check if OTP was sent recently (rate limiting - 1 minute)
    const existingOTP = otpStore.get(email);
    if (existingOTP && existingOTP.expiresAt > Date.now() + 54000) {
      // OTP sent less than 1 minute ago
      return next(
        new ErrorResponse(
          'OTP was sent recently. Please wait before requesting a new one.',
          429
        )
      );
    }

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP
    otpStore.set(email, {
      otp,
      expiresAt,
      attempts: 0,
    });

    // Always log OTP in development (before trying to send email)
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n========================================');
      console.log(`📧 OTP for ${email}`);
      console.log(`🔐 OTP Code: ${otp}`);
      console.log(`⏰ Expires in: 5 minutes`);
      console.log('========================================\n');
    }

    // Send OTP via email
    try {
      // Get user if exists to get fullName
      const user = await User.findOne({ email });
      const name = user ? user.fullName : 'User';

      await sendTemplatedEmail({
        email,
        templateType: 'OTP',
        templateData: {
          name,
          otp,
          expiresIn: '5 minutes',
        },
      });
      logger.info('OTP sent successfully', { email });
    } catch (emailError) {
      logger.error('Failed to send OTP email', {
        error: emailError.message,
        email,
      });
      // In development, OTP is already logged above
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('Email service not configured. OTP is logged in console above.');
      }
    }

    const responseData = {
      success: true,
      message: 'OTP sent successfully to your email',
    };

    // In development, include OTP in response for testing
    if (process.env.NODE_ENV !== 'production') {
      responseData.otp = otp; // Only in development
      responseData.message += ' (Check console or response for OTP in development)';
    }

    res.status(200).json(responseData);
  } catch (error) {
    logger.error('Error in sendOTP controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * @desc    Verify OTP
 * @route   POST /api/auth/verify-otp
 * @access  Public
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Object} Response with verification result and tokens
 */
export const verifyOTP = async (req, res, next) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return next(new ErrorResponse('Email and OTP are required', 400));
    }

    // Clean expired OTPs
    cleanExpiredOTPs();

    // Get stored OTP
    const storedOTP = otpStore.get(email);

    if (!storedOTP) {
      return next(new ErrorResponse('OTP not found or expired. Please request a new OTP.', 400));
    }

    // Check if OTP is expired
    if (storedOTP.expiresAt < Date.now()) {
      otpStore.delete(email);
      return next(new ErrorResponse('OTP has expired. Please request a new OTP.', 400));
    }

    // Check attempts (max 5 attempts)
    if (storedOTP.attempts >= 5) {
      otpStore.delete(email);
      return next(
        new ErrorResponse(
          'Too many failed attempts. Please request a new OTP.',
          429
        )
      );
    }

    // Verify OTP
    if (storedOTP.otp !== otp) {
      storedOTP.attempts += 1;
      return next(new ErrorResponse('Invalid OTP. Please try again.', 400));
    }

    // OTP is valid - remove from store
    otpStore.delete(email);

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return next(new ErrorResponse('User not found', 404));
    }

    // Verify the user if not already verified
    if (!user.isVerified) {
      user.isVerified = true;
      user.verificationToken = undefined;
      user.verificationTokenExpires = undefined;
      await user.save();
      logger.info('User verified via OTP', { userId: user._id });

      // Send welcome email if user is a buyer
      if (user.role === 'buyer') {
        try {
          await sendTemplatedEmail({
            email: user.email,
            templateType: 'WELCOME',
            templateData: {
              name: user.fullName,
            },
          });
          logger.info('Welcome email sent successfully', { userId: user._id });
        } catch (emailError) {
          logger.error('Failed to send welcome email', {
            error: emailError.message,
            userId: user._id,
          });
          // Don't fail the verification if welcome email fails
        }
      }
    }

    // Generate tokens
    const accessToken = generateToken({ id: user._id }, process.env.JWT_EXPIRES_IN || '1d');
    const refreshToken = generateToken(
      { id: user._id },
      process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    );

    // Remove sensitive data
    user.password = undefined;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        user,
        tokens: {
          accessToken,
          refreshToken,
        },
      },
    });
  } catch (error) {
    logger.error('Error in verifyOTP controller', {
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};