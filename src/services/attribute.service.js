import CategoryAttribute from "../models/CategoryAttribute.js";
import Category from "../models/Category.js";
import { ErrorResponse } from "../utils/errorResponse.js";

/**
 * Create a new attribute
 */
export const createAttribute = async (attributeData) => {
  const { categoryId, slug } = attributeData;

  // Validate category exists
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // Check if slug already exists for this category
  const existingAttribute = await CategoryAttribute.findOne({
    categoryId,
    slug,
  });
  if (existingAttribute) {
    throw new ErrorResponse(
      "Attribute with this slug already exists in this category",
      400
    );
  }

  const attribute = await CategoryAttribute.create(attributeData);
  return attribute;
};

/**
 * Get all attributes with filters
 */
export const getAttributes = async (filters = {}) => {
  const { categoryId, status, type, isRequired, search } = filters;

  const query = {};

  if (categoryId) query.categoryId = categoryId;
  if (status) query.status = status;
  if (type) query.type = type;
  if (isRequired !== undefined) query.isRequired = isRequired;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  const attributes = await CategoryAttribute.find(query)
    .populate("categoryId", "name slug")
    .sort({ displayOrder: 1, name: 1 });

  return attributes;
};

/**
 * Get attributes by category
 */
export const getAttributesByCategory = async (categoryId) => {
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  const attributes = await CategoryAttribute.find({
    categoryId,
    status: "active",
  }).sort({ displayOrder: 1, name: 1 });

  return attributes;
};

/**
 * Get attribute by ID
 */
export const getAttributeById = async (attributeId) => {
  const attribute = await CategoryAttribute.findById(attributeId).populate(
    "categoryId",
    "name slug"
  );

  if (!attribute) {
    throw new ErrorResponse("Attribute not found", 404);
  }

  return attribute;
};

/**
 * Update attribute
 */
export const updateAttribute = async (attributeId, updateData) => {
  const attribute = await CategoryAttribute.findById(attributeId);

  if (!attribute) {
    throw new ErrorResponse("Attribute not found", 404);
  }

  // If changing categoryId, validate new category exists
  if (
    updateData.categoryId &&
    updateData.categoryId !== String(attribute.categoryId)
  ) {
    const category = await Category.findById(updateData.categoryId);
    if (!category) {
      throw new ErrorResponse("Category not found", 404);
    }

    // Check slug uniqueness in new category
    if (attribute.slug) {
      const existingInNewCategory = await CategoryAttribute.findOne({
        categoryId: updateData.categoryId,
        slug: attribute.slug,
        _id: { $ne: attributeId },
      });
      if (existingInNewCategory) {
        throw new ErrorResponse(
          "Attribute with this slug already exists in target category",
          400
        );
      }
    }
  }

  // If changing slug (without changing category), check uniqueness in current category
  if (
    updateData.slug &&
    updateData.slug !== attribute.slug &&
    !updateData.categoryId
  ) {
    const existingAttribute = await CategoryAttribute.findOne({
      categoryId: attribute.categoryId,
      slug: updateData.slug,
      _id: { $ne: attributeId },
    });
    if (existingAttribute) {
      throw new ErrorResponse(
        "Attribute slug already exists in this category",
        400
      );
    }
  }

  Object.assign(attribute, updateData);

  await attribute.save();

  return attribute.populate("categoryId", "name slug");
};

/**
 * Delete attribute
 */
export const deleteAttribute = async (attributeId) => {
  const attribute = await CategoryAttribute.findById(attributeId);

  if (!attribute) {
    throw new ErrorResponse("Attribute not found", 404);
  }

  await attribute.deleteOne();
  return attribute;
};

/**
 * Bulk create attributes for a category
 */
export const bulkCreateAttributes = async (categoryId, attributesData) => {
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ErrorResponse("Category not found", 404);
  }

  // Add categoryId to each attribute
  const attributes = attributesData.map((attr, index) => ({
    ...attr,
    categoryId,
    displayOrder: attr.displayOrder !== undefined ? attr.displayOrder : index,
  }));

  const createdAttributes = await CategoryAttribute.insertMany(attributes);
  return createdAttributes;
};

/**
 * Update display order of attributes
 */
export const updateAttributeOrder = async (orderData) => {
  const updates = orderData.map(({ id, displayOrder }) =>
    CategoryAttribute.findByIdAndUpdate(id, { displayOrder }, { new: true })
  );

  const updatedAttributes = await Promise.all(updates);
  return updatedAttributes;
};

/**
 * Get attribute template suggestions based on category
 */
export const getAttributeTemplate = async (categoryName) => {
  // Predefined templates for common categories
  const templates = {
    "Thời Trang": [
      { name: "Chất liệu", type: "text", isRequired: true },
      {
        name: "Xuất xứ",
        type: "select",
        options: ["Việt Nam", "Trung Quốc", "Thái Lan", "Hàn Quốc"],
        isRequired: false,
      },
      { name: "Thương hiệu", type: "text", isRequired: false },
    ],
    Áo: [
      {
        name: "Chất liệu",
        type: "select",
        options: ["Cotton", "Polyester", "Lụa", "Kaki"],
        isRequired: true,
      },
      {
        name: "Kiểu cổ áo",
        type: "select",
        options: ["Cổ tròn", "Cổ V", "Cổ polo", "Cổ sơ mi"],
        isRequired: false,
      },
      {
        name: "Kiểu tay áo",
        type: "select",
        options: ["Tay ngắn", "Tay dài", "Tay lỡ", "Không tay"],
        isRequired: false,
      },
      { name: "Xuất xứ", type: "text", isRequired: false },
    ],
    "Điện Thoại": [
      { name: "Thương hiệu", type: "text", isRequired: true },
      {
        name: "Hệ điều hành",
        type: "select",
        options: ["iOS", "Android"],
        isRequired: true,
      },
      {
        name: "RAM",
        type: "select",
        options: ["4GB", "6GB", "8GB", "12GB", "16GB"],
        isRequired: true,
      },
      { name: "Màn hình", type: "text", unit: "inch", isRequired: true },
      { name: "Pin", type: "number", unit: "mAh", isRequired: false },
      { name: "Camera", type: "text", unit: "MP", isRequired: false },
    ],
    "Giày Dép": [
      {
        name: "Chất liệu",
        type: "select",
        options: ["Da thật", "Da tổng hợp", "Vải", "Nhựa"],
        isRequired: true,
      },
      {
        name: "Kiểu dáng",
        type: "select",
        options: ["Thể thao", "Tây", "Sandal", "Boot"],
        isRequired: false,
      },
      { name: "Chiều cao đế", type: "number", unit: "cm", isRequired: false },
    ],
  };

  return templates[categoryName] || [];
};
