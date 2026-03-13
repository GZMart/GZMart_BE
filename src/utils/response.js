/**
 * Send a successful response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {any} data - Response payload
 * @param {string} message - Success message
 */
export const sendResponse = (res, statusCode, data, message = 'Success') => {
  return res.status(statusCode).json({
    success: true,
    message,
    data
  });
};

/**
 * Send an error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Array} errors - Array of error details
 */
export const sendError = (res, statusCode, message = 'Error', errors = []) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors
  });
};
