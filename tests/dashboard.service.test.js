/**
 * Unit Test: getRevenueStats (Seller Dashboard – View Revenue)
 * Function Code : Function2
 * Function Name : getRevenueStats
 * Class         : DashboardService
 * Lines of code : ~80
 *
 * Test Matrix (8 cases)
 * ┌────────┬──────────────────────────────────────────────────────────────────┬──────┐
 * │ UTC ID │ Description                                                      │ Type │
 * ├────────┼──────────────────────────────────────────────────────────────────┼──────┤
 * │ UTC001 │ Valid sellerId, products & completed orders exist                │  N   │
 * │ UTC002 │ Valid sellerId, orders exist (aggregate empty) → return zeros    │  N   │
 * │ UTC003 │ Seller has exactly 1 product, orders exist                       │  B   │
 * │ UTC004 │ today = 0 but thisWeek > 0 (edge of time period boundary)        │  B   │
 * │ UTC005 │ sellerId = null → Product.find returns empty → all zeros           │  A   │
 * │ UTC006 │ Product.find throws DB error → error propagates                    │  A   │
 * │ UTC007 │ Seller has no products → return all zeros (graceful)             │  A   │
 * │ UTC008 │ Order.aggregate throws DB error → error propagates               │  A   │
 * └────────┴──────────────────────────────────────────────────────────────────┴──────┘
 *
 * Precondition : Seller has logged in (sellerId extracted from auth middleware, mocked)
 * Log message  : "success" (via controller response)
 */

import { jest } from "@jest/globals";

// ─── Mock Models ──────────────────────────────────────────────────────────────
const mockProductFind = jest.fn();
const mockOrderAggregate = jest.fn();

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: { find: mockProductFind },
}));

jest.unstable_mockModule("../src/models/Order.js", () => ({
  default: { aggregate: mockOrderAggregate },
}));

// Other models used by dashboard.service.js but not by getRevenueStats
jest.unstable_mockModule("../src/models/OrderItem.js", () => ({
  default: { aggregate: jest.fn(), find: jest.fn() },
}));
jest.unstable_mockModule("../src/models/User.js", () => ({
  default: { countDocuments: jest.fn(), find: jest.fn() },
}));
jest.unstable_mockModule("../src/models/Category.js", () => ({
  default: { find: jest.fn() },
}));

// ─── Dynamic import after mocks ───────────────────────────────────────────────
const { getRevenueStats } =
  await import("../src/services/dashboard.service.js");

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c001";
const PRODUCT_ID1 = "64f1a2b3c4d5e6f7a8b9c011";
const PRODUCT_ID2 = "64f1a2b3c4d5e6f7a8b9c012";

/** Simulate Product.find().select() chain */
const mockFindSelect = (ids) => {
  const docs = ids.map((id) => ({ _id: id }));
  return { select: jest.fn().mockResolvedValue(docs) };
};

/** Full revenue aggregate result */
const fullRevenueResult = {
  _id: null,
  today: 500000,
  thisWeek: 2000000,
  thisMonth: 8000000,
  thisYear: 50000000,
  total: 50000000,
};

// ─── Reset mocks before each test ─────────────────────────────────────────────
beforeEach(() => {
  mockProductFind.mockReturnValue(mockFindSelect([PRODUCT_ID1, PRODUCT_ID2]));
  mockOrderAggregate.mockResolvedValue([fullRevenueResult]);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("getRevenueStats – Unit Tests", () => {
  // ── NORMAL (N) ──────────────────────────────────────────────────────────────

  /**
   * UTC001 – Normal
   * Precondition : Seller has logged in; products exist; completed/delivered orders exist
   * Input        : sellerId = valid ObjectId
   * Return       : { today: 500000, thisWeek: 2000000, thisMonth: 8000000, thisYear: 50000000, total: 50000000 }
   * HTTP Code    : 200 OK
   * Log message  : "success"
   */
  test("UTC001 – Valid sellerId, products & orders exist → returns revenue object", async () => {
    const result = await getRevenueStats(SELLER_ID);

    expect(result).toBeDefined();
    expect(result.today).toBe(500000);
    expect(result.thisWeek).toBe(2000000);
    expect(result.thisMonth).toBe(8000000);
    expect(result.thisYear).toBe(50000000);
    expect(result.total).toBe(50000000);
  });

  /**
   * UTC002 – Normal
   * Precondition : Seller has logged in; products exist; Order.aggregate returns empty array
   * Input        : sellerId = valid ObjectId
   * Return       : { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, total: 0 }
   * HTTP Code    : 200 OK
   * Log message  : "success"
   */
  test("UTC002 – Valid sellerId, no completed orders → returns all zeros", async () => {
    mockOrderAggregate.mockResolvedValue([]); // simulate no completed orders

    const result = await getRevenueStats(SELLER_ID);

    expect(result).toEqual({
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    });
  });

  // ── BOUNDARY (B) ────────────────────────────────────────────────────────────

  /**
   * UTC003 – Boundary
   * Precondition : Seller has logged in; seller has exactly 1 product
   * Input        : sellerId = valid ObjectId; Product.find returns 1 product
   * Return       : Revenue object with expected values
   * HTTP Code    : 200 OK
   */
  test("UTC003 – Seller has exactly 1 product → revenue calculated correctly", async () => {
    mockProductFind.mockReturnValue(mockFindSelect([PRODUCT_ID1])); // only 1 product
    mockOrderAggregate.mockResolvedValue([
      {
        _id: null,
        today: 100000,
        thisWeek: 100000,
        thisMonth: 100000,
        thisYear: 100000,
        total: 100000,
      },
    ]);

    const result = await getRevenueStats(SELLER_ID);

    expect(result.today).toBe(100000);
    expect(result.total).toBe(100000);
    expect(mockOrderAggregate).toHaveBeenCalledTimes(1);
  });

  /**
   * UTC004 – Boundary
   * Precondition : Seller has logged in; orders exist only earlier in the week (not today)
   * Input        : sellerId = valid ObjectId
   * Return       : { today: 0, thisWeek: 1500000, thisMonth: 1500000, ... }
   * HTTP Code    : 200 OK
   */
  test("UTC004 – today = 0 but thisWeek > 0 (time period edge) → correct split", async () => {
    mockOrderAggregate.mockResolvedValue([
      {
        _id: null,
        today: 0,
        thisWeek: 1500000,
        thisMonth: 1500000,
        thisYear: 1500000,
        total: 1500000,
      },
    ]);

    const result = await getRevenueStats(SELLER_ID);

    expect(result.today).toBe(0);
    expect(result.thisWeek).toBe(1500000);
    expect(result.thisMonth).toBe(1500000);
  });

  // ── ABNORMAL (A) ────────────────────────────────────────────────────────────

  /**
   * UTC005 – Abnormal
   * Precondition : sellerId = null (middleware misconfiguration)
   * Input        : sellerId = null → Product.find({ sellerId: null }) returns empty array
   * Return       : { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, total: 0 }
   * HTTP Code    : 200 OK (getRevenueStats has no sellerId guard; returns gracefully)
   * Log message  : "success"
   */
  test("UTC005 – sellerId = null → Product.find returns empty → all zeros", async () => {
    mockProductFind.mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });

    const result = await getRevenueStats(null);

    expect(result).toEqual({
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    });
    expect(mockOrderAggregate).not.toHaveBeenCalled();
  });

  /**
   * UTC006 – Abnormal
   * Precondition : Seller logged in; DB connection drops during Product.find
   * Input        : sellerId = valid ObjectId; Product.find throws DB error
   * Exception    : Error – "Database connection error" (propagated)
   * HTTP Code    : 500 INTERNAL SERVER ERROR
   */
  test("UTC006 – Product.find throws DB error → error propagates", async () => {
    mockProductFind.mockReturnValue({
      select: jest
        .fn()
        .mockRejectedValue(new Error("Database connection error")),
    });

    await expect(getRevenueStats(SELLER_ID)).rejects.toThrow(
      "Database connection error",
    );
  });

  /**
   * UTC007 – Abnormal
   * Precondition : Seller has logged in; seller has no products listed
   * Input        : sellerId = valid ObjectId; Product.find returns []
   * Return       : { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, total: 0 }
   * HTTP Code    : 200 OK (graceful empty state)
   * Log message  : "success"
   */
  test("UTC007 – Seller has no products → returns all zeros (graceful)", async () => {
    mockProductFind.mockReturnValue({
      select: jest.fn().mockResolvedValue([]),
    });

    const result = await getRevenueStats(SELLER_ID);

    expect(result).toEqual({
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    });
    // Order.aggregate should NOT be called when there are no products
    expect(mockOrderAggregate).not.toHaveBeenCalled();
  });

  /**
   * UTC008 – Abnormal
   * Precondition : Seller has logged in; DB connection error during Order.aggregate
   * Input        : sellerId = valid ObjectId
   * Exception    : DB Error – "Database connection error" (propagated)
   * HTTP Code    : 500 INTERNAL SERVER ERROR
   */
  test("UTC008 – Order.aggregate throws DB error → error propagates", async () => {
    mockOrderAggregate.mockRejectedValue(
      new Error("Database connection error"),
    );

    await expect(getRevenueStats(SELLER_ID)).rejects.toThrow(
      "Database connection error",
    );
  });
});
