import * as attributeService from "../services/attribute.service.js";
import { ErrorResponse } from "../utils/errorResponse.js";
import { asyncHandler } from "../middlewares/async.middleware.js";

/**
 * @desc    Create a new attribute
 * @route   POST /api/attributes
 * @access  Private (Admin only)
 */
export const createAttribute = asyncHandler(async (req, res, next) => {
  const attribute = await attributeService.createAttribute(req.body);

  res.status(201).json({
    success: true,
    message: "Attribute created successfully",
    data: attribute,
  });
});

/**
 * @desc    Get all attributes
 * @route   GET /api/attributes
 * @access  Public
 */
export const getAttributes = asyncHandler(async (req, res, next) => {
  const { categoryId, status, type, isRequired, search } = req.query;

  const filters = {
    categoryId,
    status,
    type,
    isRequired:
      isRequired === "true" ? true : isRequired === "false" ? false : undefined,
    search,
  };

  const attributes = await attributeService.getAttributes(filters);

  res.status(200).json({
    success: true,
    count: attributes.length,
    data: attributes,
  });
});

/**
 * @desc    Get attributes by category
 * @route   GET /api/attributes/category/:categoryId
 * @access  Public
 */
export const getAttributesByCategory = asyncHandler(async (req, res, next) => {
  const attributes = await attributeService.getAttributesByCategory(
    req.params.categoryId
  );

  res.status(200).json({
    success: true,
    count: attributes.length,
    data: attributes,
  });
});

/**
 * @desc    Get single attribute by ID
 * @route   GET /api/attributes/:id
 * @access  Public
 */
export const getAttribute = asyncHandler(async (req, res, next) => {
  const attribute = await attributeService.getAttributeById(req.params.id);

  res.status(200).json({
    success: true,
    data: attribute,
  });
});

/**
 * @desc    Update attribute
 * @route   PUT /api/attributes/:id
 * @access  Private (Admin only)
 */
export const updateAttribute = asyncHandler(async (req, res, next) => {
  delete req.body.createdAt;
  delete req.body.updatedAt;

  const attribute = await attributeService.updateAttribute(
    req.params.id,
    req.body
  );

  res.status(200).json({
    success: true,
    message: "Attribute updated successfully",
    data: attribute,
  });
});

/**
 * @desc    Delete attribute
 * @route   DELETE /api/attributes/:id
 * @access  Private (Admin only)
 */
export const deleteAttribute = asyncHandler(async (req, res, next) => {
  await attributeService.deleteAttribute(req.params.id);

  res.status(200).json({
    success: true,
    message: "Attribute deleted successfully",
    data: {},
  });
});

/**
 * @desc    Bulk create attributes
 * @route   POST /api/attributes/bulk
 * @access  Private (Admin only)
 */
export const bulkCreateAttributes = asyncHandler(async (req, res, next) => {
  const { categoryId, attributes } = req.body;

  if (!categoryId || !attributes || !Array.isArray(attributes)) {
    return next(
      new ErrorResponse("Please provide categoryId and attributes array", 400)
    );
  }

  const createdAttributes = await attributeService.bulkCreateAttributes(
    categoryId,
    attributes
  );

  res.status(201).json({
    success: true,
    message: `${createdAttributes.length} attributes created successfully`,
    data: createdAttributes,
  });
});

/**
 * @desc    Update attribute display order
 * @route   PUT /api/attributes/order
 * @access  Private (Admin only)
 */
export const updateAttributeOrder = asyncHandler(async (req, res, next) => {
  const { orderData } = req.body;

  if (!orderData || !Array.isArray(orderData)) {
    return next(new ErrorResponse("Please provide orderData array", 400));
  }

  const updatedAttributes = await attributeService.updateAttributeOrder(
    orderData
  );

  res.status(200).json({
    success: true,
    message: "Attribute order updated successfully",
    data: updatedAttributes,
  });
});

/**
 * @desc    Get attribute template suggestions
 * @route   GET /api/attributes/template/:categoryName
 * @access  Public
 */
export const getAttributeTemplate = asyncHandler(async (req, res, next) => {
  const template = await attributeService.getAttributeTemplate(
    req.params.categoryName
  );

  res.status(200).json({
    success: true,
    data: template,
  });
});
