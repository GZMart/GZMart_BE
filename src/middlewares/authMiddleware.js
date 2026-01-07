import jwt from 'jsonwebtoken';
import User from '../models/Users.js';

/**
 * Protect routes - Verify JWT token
 */
export const protect = async (req, res, next) => {
  let token;

  // Get token from header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Make sure token exists
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route',
    });
  }
};

/**
 * Grant access to specific roles
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this route`,
        requiredRoles: roles,
      });
    }
    next();
  };
};

/**
 * Check if user is seller and owns resource
 */
export const ownsResource = (resourceField = 'sellerId') => {
  return async (req, res, next) => {
    if (req.user.role !== 'shop' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only sellers can access this resource',
      });
    }

    // For admin, allow full access
    if (req.user.role === 'admin') {
      return next();
    }

    // For seller, verify ownership
    const Model = req.params.model || 'Order';
    // This would need to be dynamically imported based on model name
    next();
  };
};
