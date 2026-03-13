import axios from "axios";
import ExchangeRate from "../models/ExchangeRate.js";
import logger from "../utils/logger.js";

// ─── External API sources (tried in order, first success wins) ──────────────

const API_SOURCES = [
  {
    name: "open.er-api.com",
    url: "https://open.er-api.com/v6/latest/CNY",
    extract: (data) => {
      if (data?.result === "success" && data?.rates?.VND) {
        return Number(data.rates.VND);
      }
      return null;
    },
  },
  {
    name: "cdn.jsdelivr.net/currency-api",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json",
    extract: (data) => {
      const rate = data?.cny?.vnd;
      return rate ? Number(rate) : null;
    },
  },
  {
    // floatrates.com — completely free, no key, updates every 12h
    name: "floatrates.com",
    url: "https://www.floatrates.com/daily/cny.json",
    extract: (data) => {
      const rate = data?.vnd?.rate;
      return rate ? Number(rate) : null;
    },
  },
];

/**
 * Try each API in order, return { rate, apiSource } for the first success.
 * Returns null if all sources fail.
 */
export const fetchRateFromExternalAPI = async () => {
  for (const source of API_SOURCES) {
    try {
      const response = await axios.get(source.url, { timeout: 8000 });
      const rate = source.extract(response.data);

      if (rate && rate > 0) {
        logger.info(`[ExchangeRate] Fetched CNY→VND = ${rate} from ${source.name}`);
        return { rate, apiSource: source.name };
      }
    } catch (err) {
      logger.warn(`[ExchangeRate] Source ${source.name} failed: ${err.message}`);
    }
  }

  logger.error("[ExchangeRate] All external API sources failed.");
  return null;
};

/**
 * Fetch a fresh rate from external APIs and persist it to the database.
 * Marks the previous active rate as inactive (soft archive).
 *
 * @returns {Promise<ExchangeRate|null>} The saved document, or null on failure.
 */
export const refreshExchangeRate = async () => {
  const fetched = await fetchRateFromExternalAPI();

  if (!fetched) {
    return null;
  }

  // Deactivate previous active records
  await ExchangeRate.updateMany(
    { baseCurrency: "CNY", targetCurrency: "VND", isActive: true },
    { $set: { isActive: false } }
  );

  const newRecord = await ExchangeRate.create({
    baseCurrency: "CNY",
    targetCurrency: "VND",
    rate: fetched.rate,
    source: "auto",
    apiSource: fetched.apiSource,
    isActive: true,
  });

  logger.info(`[ExchangeRate] Saved new rate ${fetched.rate} (id: ${newRecord._id})`);
  return newRecord;
};

/**
 * Manually set the CNY→VND exchange rate (admin/manager override).
 *
 * @param {Number} rate      - New exchange rate
 * @param {String} userId    - ID of the user making the change
 * @param {String} [note]    - Optional note/reason
 * @returns {Promise<ExchangeRate>}
 */
export const setManualRate = async (rate, userId, note = null) => {
  await ExchangeRate.updateMany(
    { baseCurrency: "CNY", targetCurrency: "VND", isActive: true },
    { $set: { isActive: false } }
  );

  const newRecord = await ExchangeRate.create({
    baseCurrency: "CNY",
    targetCurrency: "VND",
    rate,
    source: "manual",
    apiSource: null,
    isActive: true,
    updatedBy: userId,
    note,
  });

  logger.info(`[ExchangeRate] Manual override to ${rate} by user ${userId}`);
  return newRecord;
};

/**
 * Get the current active exchange rate record.
 * @returns {Promise<ExchangeRate|null>}
 */
export const getCurrentRate = async () => {
  return ExchangeRate.findOne({
    baseCurrency: "CNY",
    targetCurrency: "VND",
    isActive: true,
  })
    .sort({ createdAt: -1 })
    .lean();
};

/**
 * Get rate history (paginated).
 * @param {Number} page
 * @param {Number} limit
 * @returns {Promise<{ records: Array, total: Number }>}
 */
export const getRateHistory = async (page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const [records, total] = await Promise.all([
    ExchangeRate.find({ baseCurrency: "CNY", targetCurrency: "VND" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("updatedBy", "fullName email")
      .lean(),
    ExchangeRate.countDocuments({ baseCurrency: "CNY", targetCurrency: "VND" }),
  ]);
  return { records, total, page, pages: Math.ceil(total / limit) };
};
