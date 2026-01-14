/**
 * Order Status Validation Rules
 * Define allowed transitions and conditions for each status change
 */

const orderStatusRules = {
  // From pending, can transition to:
  pending: {
    confirmable: true,
    cancellable: true,
    canShip: false,
    description: 'Chờ xác nhận',
    nextStates: ['confirmed', 'cancelled'],
  },
  // From confirmed, can transition to:
  confirmed: {
    confirmable: false,
    cancellable: true,
    canShip: true,
    description: 'Đã xác nhận',
    nextStates: ['shipping', 'cancelled'],
    requiresShipperId: false,
  },
  // From shipping, can transition to:
  shipping: {
    confirmable: false,
    cancellable: false,
    canShip: false,
    description: 'Đang giao',
    nextStates: ['delivered'],
    requiresShipperId: true,
  },
  // From delivered, cannot transition
  delivered: {
    confirmable: false,
    cancellable: false,
    canShip: false,
    description: 'Đã giao',
    nextStates: [],
    isFinal: true,
  },
  // From cancelled, cannot transition
  cancelled: {
    confirmable: false,
    cancellable: false,
    canShip: false,
    description: 'Đã hủy',
    nextStates: [],
    isFinal: true,
  },
};

/**
 * Validate order status transition
 * @param {String} currentStatus - Current order status
 * @param {String} newStatus - Desired new status
 * @param {Object} order - Order object
 * @returns {Object} - { isValid: boolean, message: string }
 */
export const validateStatusTransition = (currentStatus, newStatus, order = {}) => {
  const rules = orderStatusRules[currentStatus];

  if (!rules) {
    return {
      isValid: false,
      message: `Invalid current status: ${currentStatus}`,
    };
  }

  if (!rules.nextStates.includes(newStatus)) {
    return {
      isValid: false,
      message: `Cannot transition from '${currentStatus}' to '${newStatus}'. Valid transitions: ${rules.nextStates.join(', ')}`,
      validTransitions: rules.nextStates,
    };
  }

  // Check specific requirements for shipping status
  if (newStatus === 'shipping' && rules.requiresShipperId && !order.shipperId) {
    return {
      isValid: false,
      message: 'Shipper ID is required to move order to shipping status',
    };
  }

  return {
    isValid: true,
    message: `Valid transition from '${currentStatus}' to '${newStatus}'`,
  };
};

/**
 * Get order status description (Vietnamese)
 */
export const getStatusDescription = (status) => {
  return orderStatusRules[status]?.description || status;
};

/**
 * Get all status rules
 */
export const getAllStatusRules = () => {
  return orderStatusRules;
};

/**
 * Check if status is final (no further transitions possible)
 */
export const isStatusFinal = (status) => {
  return orderStatusRules[status]?.isFinal || false;
};

/**
 * Get valid next statuses for current status
 */
export const getValidNextStatuses = (currentStatus) => {
  return orderStatusRules[currentStatus]?.nextStates || [];
};
