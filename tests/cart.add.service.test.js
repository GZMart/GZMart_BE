import { jest } from "@jest/globals";

const mockCartFindOne = jest.fn();
const mockCartCreate = jest.fn();

const mockCartItemFindOne = jest.fn();
const mockCartItemCreate = jest.fn();
const mockCartItemFind = jest.fn();

const mockProductFindById = jest.fn();
const mockInventoryFindOne = jest.fn();

const mockGetCampaignPrice = jest.fn();
const mockGetShopProgramPriceForVariant = jest.fn();

jest.unstable_mockModule("../src/models/Cart.js", () => ({
  default: {
    findOne: mockCartFindOne,
    create: mockCartCreate,
  },
}));

jest.unstable_mockModule("../src/models/CartItem.js", () => ({
  default: {
    findOne: mockCartItemFindOne,
    create: mockCartItemCreate,
    find: mockCartItemFind,
  },
}));

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: {
    findById: mockProductFindById,
  },
}));

jest.unstable_mockModule("../src/models/InventoryItem.js", () => ({
  default: {
    findOne: mockInventoryFindOne,
  },
}));

jest.unstable_mockModule("../src/services/campaign.service.js", () => ({
  getCampaignPrice: mockGetCampaignPrice,
}));

jest.unstable_mockModule("../src/services/product.service.js", () => ({
  getShopProgramPriceForVariant: mockGetShopProgramPriceForVariant,
}));

const { addToCart } = await import("../src/controllers/cart.controller.js");

const createMockReq = (body) => ({
  body,
  user: { _id: "user-1" },
});

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const tieredProduct = {
  _id: "prod-tiered",
  name: "Tier Product",
  tiers: [
    { name: "Color", options: ["Red"] },
    { name: "Size", options: ["M"] },
  ],
  models: [
    {
      _id: "model-1",
      sku: "SKU-RED-M",
      price: 100,
      stock: 10,
      tierIndex: [0, 0],
      isActive: true,
      image: "model-image.jpg",
    },
  ],
  images: ["product-image.jpg"],
};

const simpleProduct = {
  _id: "prod-simple",
  name: "Simple Product",
  tiers: [],
  models: [
    {
      _id: "model-simple-1",
      sku: "SKU-SIMPLE",
      price: 120,
      stock: 8,
      tierIndex: [],
      isActive: true,
      image: "simple-model-image.jpg",
    },
  ],
  images: ["simple-product-image.jpg"],
};

describe("Add To Cart - addToCart controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const cart = {
      _id: "cart-1",
      userId: "user-1",
      totalPrice: 0,
      save: jest.fn().mockResolvedValue(true),
    };

    mockProductFindById.mockResolvedValue(tieredProduct);
    mockCartFindOne.mockResolvedValue(cart);
    mockCartCreate.mockResolvedValue(cart);
    mockCartItemFindOne.mockResolvedValue(null);
    mockCartItemCreate.mockResolvedValue({ _id: "item-1" });
    mockCartItemFind.mockResolvedValue([{ price: 100, quantity: 2 }]);
    mockInventoryFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ quantity: 10 }),
    });
    mockGetCampaignPrice.mockResolvedValue({ isFlashSale: false, price: 100 });
    mockGetShopProgramPriceForVariant.mockResolvedValue({
      isShopProgram: false,
      price: 100,
    });
  });

  it("UTCID01 - Happy path: product có tiers, gửi đủ fields, còn hàng", async () => {
    // Arrange
    const req = createMockReq({
      productId: "prod-tiered",
      quantity: 2,
      color: "Red",
      size: "M",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockCartItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: "cart-1",
        productId: "prod-tiered",
        quantity: 2,
        color: "Red",
        size: "M",
        price: 100,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Item added to cart",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: thiếu productId", async () => {
    // Arrange
    const req = createMockReq({ quantity: 1, color: "Red", size: "M" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockProductFindById).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Please provide productId and quantity",
      }),
    );
  });

  it("UTCID03 - Abnormal: thiếu quantity", async () => {
    // Arrange
    const req = createMockReq({
      productId: "prod-tiered",
      color: "Red",
      size: "M",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockProductFindById).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Please provide productId and quantity",
      }),
    );
  });

  it("UTCID04 - Abnormal: productId không tồn tại", async () => {
    // Arrange
    mockProductFindById.mockResolvedValueOnce(null);
    const req = createMockReq({
      productId: "prod-not-found",
      quantity: 2,
      color: "Red",
      size: "M",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockProductFindById).toHaveBeenCalledWith("prod-not-found");
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: "Product not found",
      }),
    );
  });

  it("UTCID05 - Boundary: quantity=1, product không có tiers", async () => {
    // Arrange
    mockProductFindById.mockResolvedValueOnce(simpleProduct);
    mockCartItemFind.mockResolvedValueOnce([{ price: 120, quantity: 1 }]);
    mockGetCampaignPrice.mockResolvedValueOnce({
      isFlashSale: false,
      price: 120,
    });
    mockGetShopProgramPriceForVariant.mockResolvedValueOnce({
      isShopProgram: false,
      price: 120,
    });

    const req = createMockReq({ productId: "prod-simple", quantity: 1 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockCartItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: "prod-simple",
        quantity: 1,
        color: "Default",
        size: "Default",
        price: 120,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Item added to cart",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID06 - Abnormal: product có tiers nhưng thiếu color/size", async () => {
    // Arrange
    const req = createMockReq({
      productId: "prod-tiered",
      quantity: 1,
      color: "Red",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockProductFindById).toHaveBeenCalledWith("prod-tiered");
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Please provide productId, quantity, color, and size",
      }),
    );
  });

  it("UTCID07 - Edge: item đã tồn tại trong cart (cộng dồn quantity)", async () => {
    // Arrange
    const existingItem = {
      quantity: 1,
      price: 100,
      image: "old-image.jpg",
      save: jest.fn().mockResolvedValue(true),
    };
    mockCartItemFindOne.mockResolvedValueOnce(existingItem);
    mockCartItemFind.mockResolvedValueOnce([{ price: 100, quantity: 3 }]);

    const req = createMockReq({
      productId: "prod-tiered",
      quantity: 2,
      color: "Red",
      size: "M",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(existingItem.quantity).toBe(3);
    expect(existingItem.price).toBe(100);
    expect(existingItem.save).toHaveBeenCalledTimes(1);
    expect(mockCartItemCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Item added to cart",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID08 - Abnormal: tồn kho không đủ", async () => {
    // Arrange
    mockInventoryFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ quantity: 1 }),
    });
    const req = createMockReq({
      productId: "prod-tiered",
      quantity: 5,
      color: "Red",
      size: "M",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await addToCart(req, res, next);

    // Assert
    expect(mockProductFindById).toHaveBeenCalledWith("prod-tiered");
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Insufficient stock. Available: 1, Requested: 5",
      }),
    );
  });
});
