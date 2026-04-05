/**
 * Market Trend Data Simulator Worker
 *
 * PURPOSE:
 * Simulates real-time market trend data by generating plausible sales/view metrics
 * for each product category. Acts as an "External Data Provider" in the architecture.
 *
 * WHY THIS APPROACH:
 * - Shopee/Tiki internal APIs are blocked (90309999 - Anti-bot detection)
 * - Scraping via Puppeteer is unreliable and breaks without Chrome
 * - Data Simulator demonstrates the full ETL pipeline (Extract-Transform-Load)
 *   and Trend Scoring algorithm without depending on external infrastructure
 *
 * ARCHITECTURE:
 *   Data Simulator Worker  ──writes──►  data/shopee_mock_data.json
 *                                                 │
 *                                                 ▼
 *                           demandForecast.service.js reads JSON
 *                                         │
 *                                         ▼
 *                           Global Trend Score (0-100) + UI
 *
 * CRON: Every day at 23:00 (Asia/Ho_Chi_Minh)
 * MANUAL:  node src/scripts/run_collector.js
 */

import cron from "node-cron";
import fsExtra from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Config ─────────────────────────────────────────────────────────────────────

const ROOT_DIR = path.resolve(__dirname, "../..");
const DATA_FILE = path.join(ROOT_DIR, "data", "shopee_mock_data.json");
const RETENTION_DAYS = 30;

// ── Seed product catalog ────────────────────────────────────────────────────────
/**
 * Each entry represents a product category with realistic baseline metrics.
 * The system will generate daily variations around these baselines.
 *
 * Fields:
 *   keyword        — category search term (used for matching with product names)
 *   baseSold       — starting monthly sold count
 *   baseView       — starting monthly view count
 *   price          — representative price in K VND (e.g. 120 = 120,000 VND)
 *   volatility     — how much daily variation (0.1 = conservative, 0.4 = volatile)
 *   trendBias      — natural tendency: >0 trending up, <0 trending down, 0 stable
 *   rating         — typical rating out of 5
 */
const SEED_CATALOG = [
  // Fashion & Apparel
  { keyword: "áo thun",        baseSold: 8500,  baseView: 65000, price: 120, volatility: 0.25, trendBias:  0.08, rating: 4.5 },
  { keyword: "áo polo",        baseSold: 4200,  baseView: 32000, price: 180, volatility: 0.18, trendBias:  0.05, rating: 4.3 },
  { keyword: "hoodie nam",     baseSold: 3100,  baseView: 24000, price: 250, volatility: 0.30, trendBias:  0.10, rating: 4.4 },
  { keyword: "quần jogger",    baseSold: 6200,  baseView: 48000, price: 145, volatility: 0.22, trendBias:  0.06, rating: 4.6 },
  { keyword: "váy nữ",         baseSold: 5500,  baseView: 42000, price: 200, volatility: 0.28, trendBias:  0.04, rating: 4.2 },
  // Accessories
  { keyword: "túi xách",      baseSold: 3800,  baseView: 30000, price: 350, volatility: 0.20, trendBias:  0.07, rating: 4.1 },
  { keyword: "kính mát",       baseSold: 2800,  baseView: 21000, price: 180, volatility: 0.35, trendBias:  0.12, rating: 4.0 },
  { keyword: "mũ nón",         baseSold: 2200,  baseView: 17000, price: 90,  volatility: 0.20, trendBias:  0.03, rating: 4.3 },
  // Footwear
  { keyword: "giày sneaker",   baseSold: 9800,  baseView: 85000, price: 299, volatility: 0.30, trendBias:  0.15, rating: 4.7 },
  // Tech Accessories
  { keyword: "tai nghe bluetooth", baseSold: 5600, baseView: 45000, price: 350, volatility: 0.25, trendBias:  0.11, rating: 4.4 },
  { keyword: "bàn phím cơ",    baseSold: 2400,  baseView: 19000, price: 890, volatility: 0.15, trendBias:  0.09, rating: 4.5 },
  // Hobby & Collectibles
  { keyword: "gundam",         baseSold: 1400,  baseView: 12000, price: 550, volatility: 0.40, trendBias:  0.20, rating: 4.8 },
  // Beauty
  { keyword: "son môi",        baseSold: 7200,  baseView: 58000, price: 95,  volatility: 0.35, trendBias:  0.06, rating: 4.0 },
  { keyword: "kem dưỡng da",   baseSold: 4900,  baseView: 38000, price: 220, volatility: 0.20, trendBias:  0.05, rating: 4.1 },
  // Watches
  { keyword: "đồng hồ nam",    baseSold: 2100,  baseView: 16000, price: 480, volatility: 0.18, trendBias:  0.07, rating: 4.3 },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Clamp a value between min and max */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Generate a daily variation multiplier around 1.0.
 * Uses Gaussian-ish noise: small changes are more likely than extreme ones.
 *
 * @param {number} volatility - max deviation (0.3 = ±30% range)
 * @param {number} trendBias - constant upward drift added each day (e.g. 0.05 = +5%)
 * @returns {number} multiplier e.g. 1.12 means +12% from baseline
 */
function dailyMultiplier(volatility, trendBias) {
  // Box-Muller transform for Gaussian noise (mean=0, std=volatility/3)
  const u1 = Math.random();
  const u2 = Math.random();
  const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const gaussian = noise * (volatility / 3);

  // Add trend bias and a small seasonal component
  const seasonal = Math.sin((Date.now() / 86400000) * 0.4) * (volatility * 0.1);
  const multiplier = 1 + gaussian + trendBias + seasonal;

  return clamp(multiplier, 0.6, 2.0); // never drop below 60% or exceed 200%
}

/** Random integer within range */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Data persistence helpers ───────────────────────────────────────────────────

async function loadExistingData() {
  try {
    if (await fsExtra.pathExists(DATA_FILE)) {
      const raw = await fsExtra.readJson(DATA_FILE);
      return Array.isArray(raw) ? raw : [];
    }
  } catch (err) {
    console.warn("[Simulator] Could not read existing data:", err.message);
  }
  return [];
}

async function saveData(records) {
  // Keep only last RETENTION_DAYS days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const recent = records.filter((r) => {
    try {
      return new Date(r.date) >= cutoff;
    } catch {
      return false;
    }
  });

  await fsExtra.ensureDir(path.dirname(DATA_FILE));
  await fsExtra.writeJson(DATA_FILE, recent, { spaces: 2, encoding: "utf8" });
  return recent;
}

// ── Simulator core ─────────────────────────────────────────────────────────────

/**
 * Simulate one day's worth of market data for all categories.
 * Updates in-memory seed values so the next run has cumulative context.
 *
 * @param {Array} catalog - mutable array of seed objects (modified in place)
 * @param {string} dateStr - ISO date string "YYYY-MM-DD"
 */
function simulateDay(catalog, dateStr) {
  const records = [];

  for (const product of catalog) {
    // Generate daily variation
    const mult = dailyMultiplier(product.volatility, product.trendBias);

    // Compute metrics
    const dailySold = Math.max(1, Math.round(product.baseSold * mult * 0.04));
    const dailyView = Math.max(10, Math.round(product.baseView * mult * 0.04));
    const priceMin  = Math.round(product.price * (0.92 + Math.random() * 0.16));
    const priceMax  = Math.round(priceMin * (1.05 + Math.random() * 0.20));

    // Update seed for next run (cumulative base grows/shrinks)
    product.baseSold = Math.max(100, Math.round(product.baseSold * mult));
    product.baseView = Math.max(1000, Math.round(product.baseView * mult));

    // Product name variants for realism
    const nameTemplates = [
      `${capitalize(product.keyword)} nam nữ basic form rộng — chất vải mềm mịn`,
      `${capitalize(product.keyword)} hot trend 2026 — vải cotton thoáng mát`,
      `${capitalize(product.keyword)} cao cấp — kiểu dáng trẻ trung dễ phối đồ`,
    ];

    records.push({
      date: dateStr,
      keyword: product.keyword,
      name: nameTemplates[randInt(0, nameTemplates.length - 1)],
      historical_sold: dailySold,
      view_count: dailyView,
      price_min: priceMin,
      price_max: priceMax,
      rating: parseFloat((product.rating + (Math.random() - 0.5) * 0.3).toFixed(1)),
      // Simulated shopid/itemid for uniqueness (not used by service layer)
      shopid: randInt(1000000, 9999999),
      itemid: randInt(1000000000, 9999999999),
    });
  }

  return records;
}

function capitalize(str) {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Main function ───────────────────────────────────────────────────────────────

/**
 * Main entry point for the Data Simulator.
 * Loads existing data, generates new daily records for all categories,
 * and saves to shopee_mock_data.json.
 *
 * Called by: cron schedule OR run_collector.js
 */
export async function fetchShopeeData() {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];

  console.log(`\n[${new Date().toISOString()}] ═══════════════════════════════════════`);
  console.log(`[Simulator] 🚀 Market Trend Data Simulator — Run #${today}`);
  console.log(`[Simulator] Categories: ${SEED_CATALOG.map((p) => p.keyword).join(", ")}`);

  // Load existing records (to keep historical data)
  const existingData = await loadExistingData();
  const existingCount = existingData.length;

  // Remove records for today if re-running (avoid duplicates)
  const previousData = existingData.filter((r) => r.date !== today);

  // Simulate today's data
  const newRecords = simulateDay(SEED_CATALOG, today);

  // Merge + save
  const merged = [...previousData, ...newRecords];
  const saved = await saveData(merged);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Simulator] ✅ Done! +${newRecords.length} new records (total: ${saved.length}, removed: ${existingCount - previousData.length} stale)`);
  console.log(`[Simulator] ⏱  Completed in ${elapsed}s`);
  console.log(`[Simulator] ════════════════════════════════════════════\n`);

  return {
    newRecords: newRecords.length,
    totalRecords: saved.length,
    date: today,
  };
}

// ── Cron schedule ───────────────────────────────────────────────────────────────

// Run every day at 23:00 Vietnam time (UTC+7)
cron.schedule(
  "0 23 * * *",
  () => {
    console.log("[Simulator] ⏰ Cron triggered — starting daily simulation...");
    fetchShopeeData().catch((err) => {
      console.error("[Simulator] ❌ Cron run failed:", err.message);
    });
  },
  {
    timezone: "Asia/Ho_Chi_Minh",
  }
);

console.log("[Simulator] Cron scheduled: daily at 23:00 (Asia/Ho_Chi_Minh)");
console.log("[Simulator] To run manually: npm run run-collector");

// Auto-run when executed directly
const isMain = process.argv[1]?.endsWith("trend_collector.js");
if (isMain) {
  fetchShopeeData()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Simulator] ❌ Fatal error:", err.message);
      process.exit(1);
    });
}