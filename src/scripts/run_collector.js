/**
 * Manual trigger script for the Market Trend Data Simulator.
 *
 * Usage:
 *   npm run run-collector
 *   node src/scripts/run_collector.js
 *
 * The simulator can also be triggered from the browser:
 *   GET /api/admin/run-trend-collector   (requires admin role)
 */

import { fetchShopeeData } from "../workers/trend_collector.js";

console.log("=".repeat(60));
console.log("Market Trend Data Simulator — Manual Run");
console.log("=".repeat(60));

const start = Date.now();
try {
  const result = await fetchShopeeData();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅ Simulator finished in ${elapsed}s`);
  console.log(`   Date         : ${result.date}`);
  console.log(`   New records  : +${result.newRecords}`);
  console.log(`   Total records: ${result.totalRecords}`);
  process.exit(0);
} catch (err) {
  console.error("\n❌ Simulator failed:", err.message);
  process.exit(1);
}