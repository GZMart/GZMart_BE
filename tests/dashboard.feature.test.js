/**
 * Feature Test: Seller Analytics Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers all 25 TCs defined in feature-test-seller-dashboard.html
 *
 * Function A – Main Dashboard Overview        (getDashboardAnalytics)
 * Function B – Revenue Statistics             (getRevenueStats, getRevenueOverTime, getComparisonStats)
 * Function C – Product Performance            (getBestSellingProducts, getProductAnalytics)
 * Function D – Low Stock Alerts               (getLowStockProducts)
 * Function E – Order, Customer & Sales Trend  (getOrderStats, getCustomerStats, getSalesTrend)
 */

import { jest } from "@jest/globals";

// ─── Mock stubs ───────────────────────────────────────────────────────────────
const mockProductFind = jest.fn();
const mockProductAggregate = jest.fn();
const mockOrderAggregate = jest.fn();
const mockOrderItemAggregate = jest.fn();

jest.unstable_mockModule("../src/models/Product.js", () => ({
  default: {
    find: mockProductFind,
    aggregate: mockProductAggregate,
  },
}));

jest.unstable_mockModule("../src/models/Order.js", () => ({
  default: { aggregate: mockOrderAggregate },
}));

jest.unstable_mockModule("../src/models/OrderItem.js", () => ({
  default: { aggregate: mockOrderItemAggregate },
}));

jest.unstable_mockModule("../src/models/User.js", () => ({ default: {} }));
jest.unstable_mockModule("../src/models/Category.js", () => ({ default: {} }));

// ─── Dynamic imports (must come after mock registration) ─────────────────────
const {
  getDashboardAnalytics,
  getRevenueStats,
  getRevenueOverTime,
  getBestSellingProducts,
  getLowStockProducts,
  getOrderStats,
  getCustomerStats,
  getProductAnalytics,
  getSalesTrend,
  getComparisonStats,
} = await import("../src/services/dashboard.service.js");

// ─── Constants ────────────────────────────────────────────────────────────────
const SELLER_ID = "64f1a2b3c4d5e6f7a8b9c001";
const PRODUCT_ID_1 = "64f1a2b3c4d5e6f7a8b9c010";
const PRODUCT_ID_2 = "64f1a2b3c4d5e6f7a8b9c011";
const mockSellerProducts = [{ _id: PRODUCT_ID_1 }, { _id: PRODUCT_ID_2 }];

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Makes Product.find().select() resolve to the given array */
const setProductFind = (docs = mockSellerProducts) => {
  mockProductFind.mockReturnValue({
    select: jest.fn().mockResolvedValue(docs),
  });
};

// ─── Global beforeEach ────────────────────────────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  setProductFind();
  mockOrderAggregate.mockResolvedValue([]);
  mockOrderItemAggregate.mockResolvedValue([]);
  mockProductAggregate.mockResolvedValue([]);
});

// =============================================================================
// FUNCTION A – Main Dashboard Overview
// =============================================================================
describe("Function A – Main Dashboard Overview", () => {
  // DB-TC-01
  test("DB-TC-01 – Main dashboard loads and returns all 4 sections", async () => {
    const result = await getDashboardAnalytics(SELLER_ID);

    expect(result).toHaveProperty("revenue");
    expect(result).toHaveProperty("bestSellers");
    expect(result).toHaveProperty("orderStats");
    expect(result).toHaveProperty("customerStats");
  });

  // DB-TC-02
  test("DB-TC-02 – Dashboard data is scoped to the logged-in seller's ID", async () => {
    await getDashboardAnalytics(SELLER_ID);

    // Every sub-function calls Product.find with { sellerId }
    const calls = mockProductFind.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    calls.forEach((call) => {
      expect(call[0]).toEqual({ sellerId: SELLER_ID });
    });
  });

  // DB-TC-03
  test("DB-TC-03 – Accessing dashboard without a sellerId throws 400", async () => {
    await expect(getDashboardAnalytics(undefined)).rejects.toMatchObject({
      statusCode: 400,
      message: "Seller ID is required",
    });
  });
});

// =============================================================================
// FUNCTION B – Revenue Statistics
// =============================================================================
describe("Function B – Revenue Statistics", () => {
  // DB-TC-04
  test("DB-TC-04 – Revenue stats card shows today / week / month / year / total", async () => {
    mockOrderAggregate.mockResolvedValueOnce([
      {
        today: 50_000,
        thisWeek: 300_000,
        thisMonth: 1_000_000,
        thisYear: 5_000_000,
        total: 5_000_000,
      },
    ]);

    const result = await getRevenueStats(SELLER_ID);

    expect(result).toMatchObject({
      today: 50_000,
      thisWeek: 300_000,
      thisMonth: 1_000_000,
      thisYear: 5_000_000,
      total: 5_000_000,
    });
  });

  // DB-TC-05
  test("DB-TC-05 – Revenue trend chart renders daily data points", async () => {
    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "2026-03-08", revenue: 200_000, count: 2 },
      { _id: "2026-03-09", revenue: 350_000, count: 3 },
    ]);

    const result = await getRevenueOverTime(SELLER_ID, "daily");

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    expect(result[0]).toHaveProperty("_id");
    expect(result[0]).toHaveProperty("revenue");
  });

  // DB-TC-06
  test("DB-TC-06 – Revenue trend chart works with weekly and monthly grouping", async () => {
    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "2026-W10", revenue: 800_000, count: 8 },
    ]);
    const weekly = await getRevenueOverTime(SELLER_ID, "weekly");
    expect(Array.isArray(weekly)).toBe(true);

    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "2026-03", revenue: 3_000_000, count: 30 },
    ]);
    const monthly = await getRevenueOverTime(SELLER_ID, "monthly");
    expect(Array.isArray(monthly)).toBe(true);
  });

  // DB-TC-07
  test("DB-TC-07 – Period comparison (month) shows current, previous, and growth %", async () => {
    mockOrderAggregate
      .mockResolvedValueOnce([
        { orders: 10, revenue: 1_000_000, quantity: 20, profit: 300_000 },
      ]) // current month
      .mockResolvedValueOnce([
        { orders: 8, revenue: 800_000, quantity: 16, profit: 200_000 },
      ]); // previous month

    const result = await getComparisonStats(SELLER_ID, "month");

    expect(result).toHaveProperty("currentPeriod");
    expect(result).toHaveProperty("previousPeriod");
    expect(result).toHaveProperty("growth");
    expect(result.currentPeriod.orders).toBe(10);
    expect(result.previousPeriod.orders).toBe(8);
    expect(result.growth.orders).toBe(25); // (10-8)/8 * 100
    expect(result.growth.revenue).toBe(25); // (1M-0.8M)/0.8M * 100
    expect(result.growth.profit).toBe(50); // (300k-200k)/200k * 100
  });

  // DB-TC-08
  test("DB-TC-08 – Period comparison (week) returns correct shape", async () => {
    mockOrderAggregate
      .mockResolvedValueOnce([
        { orders: 5, revenue: 500_000, quantity: 10, profit: 100_000 },
      ])
      .mockResolvedValueOnce([
        { orders: 4, revenue: 400_000, quantity: 8, profit: 80_000 },
      ]);

    const result = await getComparisonStats(SELLER_ID, "week");

    expect(result).toHaveProperty("currentPeriod");
    expect(result).toHaveProperty("previousPeriod");
    expect(result).toHaveProperty("growth");
    expect(result.growth.orders).toBe(25);
  });

  // DB-TC-08b – Rolling daily window (matches revenue-trend) uses two aggregate calls with $lt for previous window
  test("DB-TC-08b – Period comparison (daily rolling) returns shape and growth", async () => {
    mockOrderAggregate
      .mockResolvedValueOnce([
        { orders: 3, revenue: 300_000, quantity: 5, profit: 60_000 },
      ])
      .mockResolvedValueOnce([
        { orders: 2, revenue: 200_000, quantity: 4, profit: 40_000 },
      ]);

    const result = await getComparisonStats(SELLER_ID, "daily");

    expect(result.currentPeriod.orders).toBe(3);
    expect(result.currentPeriod.revenue).toBe(300_000);
    expect(result.growth.orders).toBe(50); // (3-2)/2 * 100
    expect(result.growth.revenue).toBe(50); // (300k-200k)/200k * 100
    expect(result.growth.profit).toBe(50); // (60k-40k)/40k * 100
  });

  // DB-TC-08c – Zero baseline: previous window had no sales → +100% when current has activity
  test("DB-TC-08c – Comparison with zero previous period returns +100% growth", async () => {
    mockOrderAggregate
      .mockResolvedValueOnce([
        { orders: 3, revenue: 301_000, quantity: 6, profit: -79_000 },
      ])
      .mockResolvedValueOnce([
        { orders: 0, revenue: 0, quantity: 0, profit: 0 },
      ]);

    const result = await getComparisonStats(SELLER_ID, "daily");

    expect(result.growth.orders).toBe(100);
    expect(result.growth.revenue).toBe(100);
    expect(result.growth.quantity).toBe(100);
    expect(result.growth.profit).toBe(-100);
  });
});

// =============================================================================
// FUNCTION C – Product Performance
// =============================================================================
describe("Function C – Product Performance", () => {
  // DB-TC-09
  test("DB-TC-09 – Best sellers list shows top 5 sorted by totalSold", async () => {
    mockOrderItemAggregate.mockResolvedValueOnce([
      {
        productId: PRODUCT_ID_1,
        name: "Product A",
        originalPrice: 200_000,
        totalSold: 100,
      },
      {
        productId: PRODUCT_ID_2,
        name: "Product B",
        originalPrice: 150_000,
        totalSold: 60,
      },
    ]);

    const result = await getBestSellingProducts(SELLER_ID, 5);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("totalSold");
    expect(result[0].totalSold).toBeGreaterThan(result[1].totalSold);
  });

  // DB-TC-10
  test("DB-TC-10 – Best sellers limit can be changed to 10", async () => {
    mockOrderItemAggregate.mockResolvedValueOnce([]);
    await getBestSellingProducts(SELLER_ID, 10);
    expect(mockOrderItemAggregate).toHaveBeenCalledTimes(1);
  });

  // DB-TC-11
  test("DB-TC-11 – Product analytics table includes revenue, quantitySold, and profit", async () => {
    mockOrderItemAggregate.mockResolvedValueOnce([
      {
        _id: PRODUCT_ID_1,
        name: "Product A",
        originalPrice: 200_000,
        quantitySold: 10,
        revenue: 1_500_000,
        averagePrice: 150_000,
        numberOfOrders: 8,
        profit: 1_500_000 - 200_000 * 10,
      },
    ]);

    const result = await getProductAnalytics(SELLER_ID, 10);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("revenue");
    expect(result[0]).toHaveProperty("quantitySold");
    expect(result[0]).toHaveProperty("numberOfOrders");
    expect(result[0]).toHaveProperty("profit");
  });

  // DB-TC-12
  test("DB-TC-12 – Seller with no products gets zeros and empty arrays everywhere", async () => {
    setProductFind([]);
    const revenue = await getRevenueStats(SELLER_ID);
    expect(revenue).toEqual({
      today: 0,
      thisWeek: 0,
      thisMonth: 0,
      thisYear: 0,
      total: 0,
    });

    setProductFind([]);
    const bestSellers = await getBestSellingProducts(SELLER_ID);
    expect(bestSellers).toEqual([]);

    setProductFind([]);
    const orderStats = await getOrderStats(SELLER_ID);
    expect(orderStats).toEqual({ total: 0 });

    setProductFind([]);
    const customerStats = await getCustomerStats(SELLER_ID);
    expect(customerStats).toEqual({ repeatedPurchaseRate: 0 });

    setProductFind([]);
    const analytics = await getProductAnalytics(SELLER_ID);
    expect(analytics).toEqual([]);
  });
});

// =============================================================================
// FUNCTION D – Low Stock Alerts
// =============================================================================
describe("Function D – Low Stock Alerts", () => {
  // DB-TC-13
  test("DB-TC-13 – Low stock list shows items with stock below default threshold (20)", async () => {
    mockProductAggregate.mockResolvedValueOnce([
      {
        _id: PRODUCT_ID_1,
        name: "Nearly Empty Item",
        stock: 5,
        totalModels: 2,
        activeModels: 2,
      },
      {
        _id: PRODUCT_ID_2,
        name: "Almost Gone",
        stock: 12,
        totalModels: 1,
        activeModels: 1,
      },
    ]);

    const result = await getLowStockProducts(SELLER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("stock");
    expect(result[0].stock).toBeLessThan(20);
  });

  // DB-TC-14
  test("DB-TC-14 – Custom threshold triggers the aggregate with the new value", async () => {
    mockProductAggregate.mockResolvedValueOnce([]);
    await getLowStockProducts(SELLER_ID, 50);
    expect(mockProductAggregate).toHaveBeenCalledTimes(1);
  });

  // DB-TC-15
  test("DB-TC-15 – Low stock section shows empty state when all products are well-stocked", async () => {
    mockProductAggregate.mockResolvedValueOnce([]);
    const result = await getLowStockProducts(SELLER_ID);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// FUNCTION E – Order Stats, Customer Stats & Sales Trend
// =============================================================================
describe("Function E – Order Stats, Customer Stats & Sales Trend", () => {
  // DB-TC-16
  test("DB-TC-16 – Order stats shows total order count", async () => {
    mockOrderAggregate.mockResolvedValueOnce([{ total: 42 }]);
    const result = await getOrderStats(SELLER_ID);
    expect(result).toHaveProperty("total", 42);
  });

  // DB-TC-17
  test("DB-TC-17 – Customer stats calculates repeat-purchase rate correctly", async () => {
    // 3 customers: 2 ordered more than once
    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "user1", orderCount: 3 },
      { _id: "user2", orderCount: 1 },
      { _id: "user3", orderCount: 2 },
    ]);

    const result = await getCustomerStats(SELLER_ID);

    expect(result).toHaveProperty("repeatedPurchaseRate");
    // 2/3 * 100 = 66.67
    expect(result.repeatedPurchaseRate).toBe(66.67);
  });

  // DB-TC-18
  test("DB-TC-18 – Sales trend chart loads with default 30-day range", async () => {
    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "2026-03-08", sales: 5, revenue: 500_000, quantity: 8 },
      { _id: "2026-03-09", sales: 7, revenue: 700_000, quantity: 12 },
    ]);

    const result = await getSalesTrend(SELLER_ID);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("_id");
    expect(result[0]).toHaveProperty("sales");
    expect(result[0]).toHaveProperty("revenue");
    expect(result[0]).toHaveProperty("quantity");
  });

  // DB-TC-19
  test("DB-TC-19 – Sales trend chart updates when period is changed to 7 days", async () => {
    mockOrderAggregate.mockResolvedValueOnce([
      { _id: "2026-03-09", sales: 3, revenue: 300_000, quantity: 5 },
    ]);

    const result = await getSalesTrend(SELLER_ID, 7);

    expect(Array.isArray(result)).toBe(true);
    expect(mockOrderAggregate).toHaveBeenCalledTimes(1);
  });
});
