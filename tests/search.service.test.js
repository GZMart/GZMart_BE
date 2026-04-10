import { jest } from "@jest/globals";

// Mock service layer so controller unit tests are isolated from DB/service implementation.
const mockSearchProducts = jest.fn();

jest.unstable_mockModule("../src/services/search.service.js", () => ({
  default: {
    searchProducts: mockSearchProducts,
    getSearchSuggestions: jest.fn(),
    autocomplete: jest.fn(),
    getAvailableFilters: jest.fn(),
    advancedSearchProducts: jest.fn(),
    searchByImage: jest.fn(),
  },
}));

const { searchProducts } =
  await import("../src/controllers/search.controller.js");

const createMockReq = (query = {}) => ({ query });

const createMockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("Search Product - searchProducts controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSearchProducts.mockResolvedValue({
      products: [{ _id: "p1", name: "IPhone 15" }],
      query: "iphone",
      pagination: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
  });

  it("UTCID01 - Happy path: tìm kiếm với từ khóa hợp lệ, default params", async () => {
    // Arrange
    const req = createMockReq({ q: "iphone" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockSearchProducts).toHaveBeenCalledWith({
      query: "iphone",
      page: 1,
      limit: 20,
      sort: "relevance",
      filters: {
        categoryId: undefined,
        brand: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        minRating: undefined,
        inStock: false,
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Search completed successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID02 - Abnormal: thiếu query q", async () => {
    // Arrange
    const req = createMockReq({});
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Search query is required",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID03 - Abnormal: query q là chuỗi rỗng", async () => {
    // Arrange
    const req = createMockReq({ q: "" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Search query is required",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID04 - Abnormal: query q chỉ có khoảng trắng", async () => {
    // Arrange
    const req = createMockReq({ q: "   " });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: "Search query is required",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID05 - Boundary: page=1, limit=1", async () => {
    // Arrange
    const req = createMockReq({ q: "phone", page: "1", limit: "1" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
    const calledOptions = mockSearchProducts.mock.calls[0][0];
    expect(calledOptions.query).toBe("phone");
    expect(calledOptions.page).toBe(1);
    expect(calledOptions.limit).toBe(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Search completed successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID06 - Abnormal: page=-1, limit='abc'", async () => {
    // Arrange
    const req = createMockReq({ q: "phone", page: "-1", limit: "abc" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
    const calledOptions = mockSearchProducts.mock.calls[0][0];
    expect(calledOptions.query).toBe("phone");
    expect(calledOptions.page).toBe(-1);
    expect(Number.isNaN(calledOptions.limit)).toBe(true);
    expect(calledOptions.sort).toBe("relevance");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Search completed successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID07 - Normal: đầy đủ optional filters", async () => {
    // Arrange
    const req = createMockReq({
      q: "phone",
      categoryId: "cat123",
      brand: "Apple",
      minPrice: "100",
      maxPrice: "2000",
      minRating: "4.5",
      inStock: "true",
      sort: "price_asc",
    });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
    expect(mockSearchProducts).toHaveBeenCalledWith({
      query: "phone",
      page: 1,
      limit: 20,
      sort: "price_asc",
      filters: {
        categoryId: "cat123",
        brand: ["Apple"],
        minPrice: 100,
        maxPrice: 2000,
        minRating: 4.5,
        inStock: true,
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Search completed successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("UTCID08 - Abnormal: từ khóa hợp lệ nhưng không có kết quả", async () => {
    // Arrange
    mockSearchProducts.mockResolvedValueOnce({
      products: [],
      query: "zzzz_not_found_keyword",
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
    const req = createMockReq({ q: "zzzz_not_found_keyword" });
    const res = createMockRes();
    const next = jest.fn();

    // Act
    await searchProducts(req, res, next);

    // Assert
    expect(mockSearchProducts).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        message: "Search completed successfully",
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
