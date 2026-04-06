/**
 * Unit Test: getBestSellingProducts (Seller Dashboard – View Best Sellers)
 * Function Code : Function3
 * Function Name : getBestSellingProducts
 * Class         : DashboardService
 * Lines of code : ~55
 *
 * Test Matrix (6 cases)
 * ┌────────┬───────────────────────────────────────────────────────────────────┬──────┐
 * │ UTC ID │ Description                                                       │ Type │
 * ├────────┼───────────────────────────────────────────────────────────────────┼──────┤
 * │ UTC001 │ Valid sellerId, products & order items exist → sorted list        │  N   │
 * │ UTC002 │ Custom limit=2 → returns at most 2 items                          │  N   │
 * │ UTC003 │ limit = 1 (boundary) → returns only top 1 best seller             │  B   │
 * │ UTC004 │ Seller has no products → returns [] without calling aggregate     │  A   │
 * │ UTC005 │ Products exist but no order items → aggregate returns [] → []     │  A   │
 * │ UTC006 │ OrderItem.aggregate throws DB error → error propagates            │  A   │
 * └────────┴───────────────────────────────────────────────────────────────────┴──────┘
 *
 * Precondition : Seller has logged in (sellerId từ auth middleware, mocked)
 * Log message  : "success" (via controller response)
 */

import { jest } from "@jest/globals";

// ─── Mock Models ──────────────────────────────────────────────────────────────
const mockProductFind = jest.fn();
const mockOrderItemAggregate = jest.fn();

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: { find: mockProductFind },
}));

jest.unstable_mockModule("../src/models/OrderItem.js", () => ({
  default: { aggregate: mockOrderItemAggregate },
}));

// Other models imported by dashboard.service.js (not used by this function)
jest.unstable_mockModule("../src/models/Order.js", () => ({
  default: { aggregate: jest.fn(), find: jest.fn(), countDocuments: jest.fn() },
}));
jest.unstable_mockModule("../src/models/User.js", () => ({
  default: { aggregate: jest.fn(), countDocuments: jest.fn() },
}));
jest.unstable_mockModule("../src/models/Category.js", () => ({
  default: { find: jest.fn() },
}));

// ─── Dynamic import after mocks ───────────────────────────────────────────────
const { getBestSellingProducts } =
  await import("../src/services/dashboard.service.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c001";
const PRODUCT_ID1 = "64f1a2b3c4d5e6f7a8b9c011";
const PRODUCT_ID2 = "64f1a2b3c4d5e6f7a8b9c012";
const PRODUCT_ID3 = "64f1a2b3c4d5e6f7a8b9c013";

/** Simulate Product.find().select() chain */
const mockFindSelect = (docs) => ({
  select: jest.fn().mockResolvedValue(docs),
});

const sellerProductDocs = [
  { _id: PRODUCT_ID1, name: "Product A", originalPrice: 300000 },
  { _id: PRODUCT_ID2, name: "Product B", originalPrice: 150000 },
  { _id: PRODUCT_ID3, name: "Product C", originalPrice: 200000 },
];

/** Typical aggregate result – already sorted by totalSold desc */
const aggregateResult = [
  {
    productId: PRODUCT_ID1,
    name: "Product A",
    originalPrice: 300000,
    totalSold: 120,
  },
  {
    productId: PRODUCT_ID2,
    name: "Product B",
    originalPrice: 150000,
    totalSold: 80,
  },
  {
    productId: PRODUCT_ID3,
    name: "Product C",
    originalPrice: 200000,
    totalSold: 45,
  },
];

// ─── Reset mocks before each test ─────────────────────────────────────────────
beforeEach(() => {
  mockProductFind.mockReturnValue(mockFindSelect(sellerProductDocs));
  mockOrderItemAggregate.mockResolvedValue(aggregateResult);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getBestSellingProducts – Unit Tests", () => {
  // ── NORMAL (N) ──────────────────────────────────────────────────────────────

  /**
   * UTC001 – Normal
   * Precondition : Seller logged in; products exist; order items exist
   * Input        : sellerId = valid ObjectId, limit = default (5)
   * Return       : Array of { productId, name, originalPrice, totalSold }
   *                sorted by totalSold descending
   * HTTP Code    : 200 OK
   * Log message  : "success"
   */
  test("UTC001 – Valid sellerId, products & order items exist → returns sorted best sellers", async () => {
    const result = await getBestSellingProducts(SELLER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(3);
    expect(result[0].totalSold).toBe(120); // highest
    expect(result[1].totalSold).toBe(80);
    expect(result[2].totalSold).toBe(45);
    expect(result[0]).toMatchObject({
      productId: PRODUCT_ID1,
      name: "Product A",
      originalPrice: 300000,
      totalSold: 120,
    });
  });

  /**
   * UTC002 – Normal
   * Precondition : Seller logged in; products exist; order items exist
   * Input        : sellerId = valid ObjectId, limit = 2
   * Return       : Array of max 2 items (aggregate $limit = 2)
   * HTTP Code    : 200 OK
   * Log message  : "success"
   */
  test("UTC002 – Custom limit=2 → returns at most 2 items", async () => {
    const top2 = aggregateResult.slice(0, 2);
    mockOrderItemAggregate.mockResolvedValue(top2);

    const result = await getBestSellingProducts(SELLER_ID, 2);

    expect(result.length).toBe(2);
    expect(result[0].name).toBe("Product A");
    expect(result[1].name).toBe("Product B");
    // Verify $limit was passed correctly inside the aggregate pipeline
    const pipeline = mockOrderItemAggregate.mock.calls[0][0];
    const limitStage = pipeline.find((s) => s.$limit !== undefined);
    expect(limitStage.$limit).toBe(2);
  });

  // ── BOUNDARY (B) ────────────────────────────────────────────────────────────

  /**
   * UTC003 – Boundary
   * Precondition : Seller logged in; products & order items exist
   * Input        : sellerId = valid ObjectId, limit = 1 (lower boundary)
   * Return       : Array with exactly 1 item (top best seller)
   * HTTP Code    : 200 OK
   */
  test("UTC003 – limit = 1 (boundary) → returns only top 1 best seller", async () => {
    mockOrderItemAggregate.mockResolvedValue([aggregateResult[0]]);

    const result = await getBestSellingProducts(SELLER_ID, 1);

    expect(result.length).toBe(1);
    expect(result[0].totalSold).toBe(120);
    const pipeline = mockOrderItemAggregate.mock.calls[0][0];
    const limitStage = pipeline.find((s) => s.$limit !== undefined);
    expect(limitStage.$limit).toBe(1);
  });

  // ── ABNORMAL (A) ────────────────────────────────────────────────────────────

  /**
   * UTC004 – Abnormal
   * Precondition : Seller logged in; seller has no products in DB
   * Input        : sellerId = valid ObjectId; Product.find returns []
   * Return       : [] (early return, OrderItem.aggregate NOT called)
   * HTTP Code    : 200 OK (graceful empty state)
   * Log message  : "success"
   */
  test("UTC004 – Seller has no products → returns [] without calling aggregate", async () => {
    mockProductFind.mockReturnValue(mockFindSelect([]));

    const result = await getBestSellingProducts(SELLER_ID);

    expect(result).toEqual([]);
    expect(mockOrderItemAggregate).not.toHaveBeenCalled();
  });

  /**
   * UTC005 – Abnormal
   * Precondition : Seller logged in; products exist; but no order items in DB
   * Input        : sellerId = valid ObjectId; OrderItem.aggregate returns []
   * Return       : []
   * HTTP Code    : 200 OK
   * Log message  : "success"
   */
  test("UTC005 – Products exist but no order items → aggregate returns [] → returns []", async () => {
    mockOrderItemAggregate.mockResolvedValue([]);

    const result = await getBestSellingProducts(SELLER_ID);

    expect(result).toEqual([]);
    expect(mockOrderItemAggregate).toHaveBeenCalledTimes(1);
  });

  /**
   * UTC006 – Abnormal
   * Precondition : Seller logged in; DB connection drops during OrderItem.aggregate
   * Input        : sellerId = valid ObjectId; OrderItem.aggregate throws DB error
   * Exception    : Error – "Database connection error" (propagated)
   * HTTP Code    : 500 INTERNAL SERVER ERROR
   */
  test("UTC006 – OrderItem.aggregate throws DB error → error propagates", async () => {
    mockOrderItemAggregate.mockRejectedValue(
      new Error("Database connection error"),
    );

    await expect(getBestSellingProducts(SELLER_ID)).rejects.toThrow(
      "Database connection error",
    );
  });
});
