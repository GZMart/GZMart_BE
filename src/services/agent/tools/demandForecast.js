import mongoose from "mongoose";
import * as demandForecastService from "../../demandForecast.service.js";
import { registerTool } from "../tools.js";

async function execute({ sellerId, days = 90, trendDays = 30 }) {
  if (!sellerId) {
    return { context: "Seller ID is required to view demand forecast." };
  }

  try {
    const data = await demandForecastService.getDemandForecast(sellerId, {
      days,
      trendDays,
      includeWebTrends: true,
    });

    // ── Rate-limit hit ──────────────────────────────────────────────────────
    if (data._rateLimit && !data._rateLimit.allowed) {
      const { reason, message } = data._rateLimit;
      if (reason === "daily_limit") {
        return {
          context: `Forecast request blocked.\n\n${message}\n\nThis limit protects the system from excessive API calls. Please wait and try again later.`,
        };
      }
      if (reason === "product_cooldown") {
        return {
          context: `Forecast request blocked.\n\n${message}\n\nThe system prevents duplicate requests within 60 seconds to avoid redundant web searches.`,
        };
      }
      return {
        context: `Forecast request blocked: ${message}`,
      };
    }

    if (data.summary === null) {
      return {
        context: "Unable to retrieve demand forecast data at this time. Please try again later.",
      };
    }

    if (data.summary.totalProducts === 0) {
      return {
        context: "No products found or no sales data available for this shop yet.",
        _cached: data._cached,
      };
    }

    const cachedNote = data._cached
      ? " [Cached — results refreshed automatically every 30 minutes]"
      : "";

    const summaryLines = [
      `Summary:${cachedNote}`,
      `  - Products tracked: ${data.summary.totalProducts}`,
      `  - Trending products: ${data.summary.trendingProducts}`,
      `  - Trending up: ${data.summary.trendingUp}`,
      `  - Trending down: ${data.summary.trendingDown}`,
      `  - Urgent restock: ${data.summary.urgentRestock} SKUs`,
      `  - Moderate restock / opportunity: ${data.summary.moderateRestock}`,
    ];

    let productLines = [];
    if (data.trendingProducts.length > 0) {
      productLines = data.trendingProducts.slice(0, 10).map((p) => {
        const trendIcon =
          p.trendCategory === "trending_up"
            ? "TRENDING UP"
            : p.trendCategory === "trending_down"
            ? "TRENDING DOWN"
            : "STABLE";
        const pct = p.displayTrendPct >= 0 ? `+${p.displayTrendPct}%` : `${p.displayTrendPct}%`;
        const webInfo = p.hasWebData ? ` [Web score: ${p.globalTrendScore}]` : "";
        const catInfo = p.category ? ` | ${p.category}` : "";
        const restockInfo =
          p.suggestedQty > 0 ? ` | Suggested PO: +${p.suggestedQty}` : "";
        return `  ${trendIcon}: ${p.name}${catInfo} — ${pct}${webInfo} | Sold: ${p.displayQty}${restockInfo}`;
      });
    } else {
      productLines = ["  No trending products detected in this period."];
    }

    const periodNote =
      data.dataPeriod?.forecastAccuracy === "high"
        ? "7-day forecast (higher accuracy)"
        : "30-day forecast (standard accuracy)";

    const context = `=== TREND PREDICTION & DEMAND FORECAST ===
(${periodNote} | ${data.dataPeriod?.days || days} days of historical data)

${summaryLines.join("\n")}

TRENDING PRODUCTS (${data.trendingProducts.length}):
${productLines.join("\n")}

Note: Web trend data is sourced from Shopee & Tiki. Products with high web scores + local sales momentum are flagged as trending. Consider restocking even products with stock > 0 if they are trending up.`;

    return { context };
  } catch (error) {
    console.error("[demandForecast] Tool error:", error);
    return { context: "Unable to retrieve demand forecast data. Please try again later." };
  }
}

registerTool("demandForecast", {
  description:
    "Predict product demand trends and recommend restocking for seller based on local sales and web market data",
  roles: ["seller"],
  keywords: [
    "forecast", "predict", "trend", "trending", "demand",
    "restock", "restock suggestion", "purchase order", "restock recommendation",
    "trending product", "hot product", "popular product",
    "market trend", "web trend", "search trend", "shopee trend", "tiki trend",
    "inventory", "stock alert", "low stock", "out of stock",
    "sales performance", "top product", "best seller",
    "7 day forecast", "30 day forecast",
    "nhap hang", "du bao", "xu huong", "ban chay",
  ],
  execute,
});
