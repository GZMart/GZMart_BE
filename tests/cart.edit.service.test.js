import { jest } from "@jest/globals";

const mockCartFindOne = jest.fn();
const mockCartCreate = jest.fn();

const mockCartItemFindById = jest.fn();
const mockCartItemFind = jest.fn();

const mockInventoryFindOne = jest.fn();

jest.unstable_mockModule("../src/models/Cart.js", () => ({
  default: {
    findOne: mockCartFindOne,
    create: mockCartCreate,
  },
}));

jest.unstable_mockModule("../src/models/CartItem.js", () => ({
  default: {
    findById: mockCartItemFindById,
    find: mockCartItemFind,
  },
}));

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: {
    findById: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/models/InventoryItem.js", () => ({
  default: {
    findOne: mockInventoryFindOne,
  },
}));

jest.unstable_mockModule("../src/services/campaign.service.js", () => ({
  getCampaignPrice: jest.fn(),
}));

jest.unstable_mockModule("../src/services/product.service.js", () => ({
  getShopProgramPriceForVariant: jest.fn(),
}));

const { getCart, updateCartItem } =
  await import("../src/controllers/cart.controller.js");

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const createGetReq = () => ({ user: { _id: "user-1" } });

const createUpdateReq = ({ itemId, quantity }) => ({
  params: { itemId },
  body: { quantity },
  user: { _id: "user-1" },
});

const buildCartItemDoc = ({
  itemId = "item-1",
  productId = "prod-1",
  color = "Red",
  size = "M",
  quantity = 2,
  price = 100,
} = {}) => ({
  _id: itemId,
  productId: {
    _id: productId,
    name: "Product A",
    slug: "product-a",
    images: ["p-a.jpg"],
    tiers: [
      { name: "Color", options: ["Red"] },
      { name: "Size", options: ["M"] },
    ],
    models: [
      {
        _id: "model-1",
        sku: "SKU-1",
        stock: 10,
        price,
        tierIndex: [0, 0],
        isActive: true,
      },
    ],
  },
  color,
  size,
  quantity,
  price,
  cartId: "cart-1",
  save: jest.fn().mockResolvedValue(true),
  toObject: jest.fn().mockReturnValue({
    _id: itemId,
    color,
    size,
    quantity,
    price,
  }),
});

describe("View & Update Cart - cart.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const cart = {
      _id: "cart-1",
      userId: "user-1",
      totalPrice: 200,
      items: [buildCartItemDoc()],
      populate: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
    };

    mockCartFindOne.mockResolvedValue(cart);
    mockCartCreate.mockResolvedValue({
      _id: "cart-new",
      userId: "user-1",
      totalPrice: 0,
      items: [],
      populate: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
    });

    mockCartItemFindById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(buildCartItemDoc()),
    });

    mockCartItemFind.mockResolvedValue([{ price: 100, quantity: 2 }]);

    mockInventoryFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ quantity: 10 }),
    });
  });

  it("UTCID01 - Happy path: xem giỏ hàng có items", async () => {
    // Arrange
    const req = createGetReq();
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getCart(req, res, next);

    // Assert
    expect(mockCartFindOne).toHaveBeenCalledWith({ userId: "user-1" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          _id: "cart-1",
          userId: "user-1",
          items: expect.any(Array),
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: thiếu quantity khi update", async () => {
    // Arrange
    const req = createUpdateReq({ itemId: "item-1", quantity: undefined });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(mockCartItemFindById).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Quantity must be at least 1",
      }),
    );
  });

  it("UTCID03 - Abnormal: itemId không tồn tại trong DB", async () => {
    // Arrange
    mockCartItemFindById.mockReturnValueOnce({
      populate: jest.fn().mockResolvedValue(null),
    });

    const req = createUpdateReq({ itemId: "item-not-found", quantity: 2 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: "Cart item not found",
      }),
    );
  });

  it("UTCID04 - Abnormal: không phải owner cart", async () => {
    // Arrange
    const cartItemDoc = buildCartItemDoc();
    mockCartItemFindById.mockReturnValueOnce({
      populate: jest.fn().mockResolvedValue(cartItemDoc),
    });
    mockCartFindOne.mockResolvedValueOnce(null);

    const req = createUpdateReq({ itemId: "item-1", quantity: 2 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: "Not authorized",
      }),
    );
  });

  it("UTCID05 - Boundary: update quantity = 1", async () => {
    // Arrange
    const cartItemDoc = buildCartItemDoc({ quantity: 3 });
    mockCartItemFindById.mockReturnValueOnce({
      populate: jest.fn().mockResolvedValue(cartItemDoc),
    });
    const ownedCart = {
      _id: "cart-1",
      userId: "user-1",
      totalPrice: 300,
      save: jest.fn().mockResolvedValue(true),
    };
    mockCartFindOne.mockResolvedValueOnce(ownedCart);
    mockCartItemFind.mockResolvedValueOnce([{ price: 100, quantity: 1 }]);

    const req = createUpdateReq({ itemId: "item-1", quantity: 1 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(cartItemDoc.quantity).toBe(1);
    expect(cartItemDoc.save).toHaveBeenCalledTimes(1);
    expect(ownedCart.save).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: cartItemDoc,
        cartTotal: 100,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID06 - Abnormal: quantity < 1", async () => {
    // Arrange
    const req = createUpdateReq({ itemId: "item-1", quantity: 0 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(mockCartItemFindById).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Quantity must be at least 1",
      }),
    );
  });

  it("UTCID07 - Edge: xem giỏ hàng khi cart chưa tồn tại (auto-create)", async () => {
    // Arrange
    const emptyCart = {
      _id: "cart-new",
      userId: "user-1",
      totalPrice: 0,
      items: [],
      populate: jest.fn().mockResolvedValue(true),
      save: jest.fn().mockResolvedValue(true),
    };
    mockCartFindOne.mockResolvedValueOnce(null);
    mockCartCreate.mockResolvedValueOnce(emptyCart);

    const req = createGetReq();
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await getCart(req, res, next);

    // Assert
    expect(mockCartCreate).toHaveBeenCalledWith({
      userId: "user-1",
      totalPrice: 0,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          _id: "cart-new",
          items: [],
          totalPrice: 0,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID08 - Abnormal: update quantity vượt tồn kho", async () => {
    // Arrange
    const cartItemDoc = buildCartItemDoc();
    mockCartItemFindById.mockReturnValueOnce({
      populate: jest.fn().mockResolvedValue(cartItemDoc),
    });
    mockCartFindOne.mockResolvedValueOnce({
      _id: "cart-1",
      userId: "user-1",
      save: jest.fn().mockResolvedValue(true),
    });
    mockInventoryFindOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({ quantity: 1 }),
    });

    const req = createUpdateReq({ itemId: "item-1", quantity: 5 });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await updateCartItem(req, res, next);

    // Assert
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Insufficient stock. Available: 1, Requested: 5",
      }),
    );
  });
});
