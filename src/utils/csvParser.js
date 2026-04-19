import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { ErrorResponse } from "./errorResponse.js";

const stripBom = (s) => (typeof s === "string" ? s.replace(/^\uFEFF/, "").trim() : s);

const normalizeRecord = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = stripBom(k);
    if (!key) continue;
    out[key] = typeof v === "string" ? v.trim() : v;
  }
  return out;
};

const isEmptyRow = (row) =>
  Object.keys(row).length === 0 ||
  Object.values(row).every(
    (v) => v === undefined || v === null || String(v).trim() === "",
  );

/**
 * Parse CSV buffer and return raw records
 * @param {Buffer} buffer - CSV file buffer
 * @returns {Array} Parsed CSV records
 */
export const parseCSVBuffer = (buffer) => {
  try {
    const content = buffer.toString("utf-8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    });
    return records;
  } catch (err) {
    throw new ErrorResponse(`CSV parsing failed: ${err.message}`, 400);
  }
};

/**
 * Chuyển sheet đầu tiên của file Excel (.xlsx / .xls) thành mảng object giống CSV.
 */
export const parseExcelBuffer = (buffer) => {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new ErrorResponse("Excel file has no sheets", 400);
    }
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
      raw: false,
    });
    return rows;
  } catch (err) {
    throw new ErrorResponse(`Excel parsing failed: ${err.message}`, 400);
  }
};

/**
 * Parse tier options from semicolon-separated string
 * @param {string} optionsStr - "S;M;L;XL" format
 * @returns {Array} ["S", "M", "L", "XL"]
 */
const parseTierOptions = (optionsStr) => {
  if (!optionsStr || typeof optionsStr !== "string") return [];
  return optionsStr
    .split(";")
    .map((opt) => opt.trim())
    .filter((opt) => opt.length > 0);
};

/**
 * Extract tier definitions from a single product header row
 * @param {Object} row - CSV record
 * @returns {Array} Array of tier objects with name and options
 */
const extractTiersFromRow = (row) => {
  const tiers = [];
  let tierIndex = 1;

  while (true) {
    const tierName = row[`tier${tierIndex}_name`];
    const tierOptions = row[`tier${tierIndex}_options`];

    if (!tierName || !tierOptions) break;

    const options = parseTierOptions(tierOptions);
    if (options.length === 0) {
      throw new ErrorResponse(
        `Tier ${tierIndex} has no valid options`,
        400,
      );
    }

    tiers.push({
      name: tierName.trim(),
      options,
      images: [], // Will be filled if variant images provided
    });

    tierIndex++;
  }

  return tiers;
};

/**
 * Find tierIndex array based on tierValue matches
 * @param {Array} tiers - Tier definitions
 * @param {Object} row - CSV record with tierValue1, tierValue2, etc.
 * @returns {Array} tierIndex array
 */
const findTierIndexFromValues = (tiers, row) => {
  const tierIndex = [];

  for (let i = 0; i < tiers.length; i++) {
    const tierValueKey = `tierValue${i + 1}`;
    const tierValue = row[tierValueKey];

    if (!tierValue) {
      throw new ErrorResponse(
        `Model missing tierValue${i + 1} for tier "${tiers[i].name}"`,
        400,
      );
    }

    const optionIndex = tiers[i].options.indexOf(tierValue.trim());
    if (optionIndex === -1) {
      throw new ErrorResponse(
        `Invalid tierValue for tier "${tiers[i].name}": "${tierValue}" not in options [${tiers[i].options.join(", ")}]`,
        400,
      );
    }

    tierIndex.push(optionIndex);
  }

  return tierIndex;
};

/** Danh mục không có trong file — luôn gán sau (AI + xác nhận). */
const validateSingleProductRow = (row, rowIndex) => {
  if (!row.name || !row.name.trim()) {
    throw new ErrorResponse(`Row ${rowIndex}: Product name is required`, 400);
  }

  if (row.price === undefined || row.price === "") {
    throw new ErrorResponse(`Row ${rowIndex}: Price is required`, 400);
  }
  if (isNaN(parseFloat(row.price))) {
    throw new ErrorResponse(`Row ${rowIndex}: Price must be a number`, 400);
  }
  if (row.stock === undefined || row.stock === "") {
    throw new ErrorResponse(`Row ${rowIndex}: Stock is required`, 400);
  }
  if (isNaN(parseInt(row.stock))) {
    throw new ErrorResponse(`Row ${rowIndex}: Stock must be a number`, 400);
  }
};

const validateVariantProductRow = (row, rowIndex) => {
  if (!row.name || !row.name.trim()) {
    throw new ErrorResponse(`Row ${rowIndex}: Product name is required`, 400);
  }

  // Must have at least one tier definition
  const tiers = extractTiersFromRow(row);
  if (tiers.length === 0) {
    throw new ErrorResponse(
      `Row ${rowIndex}: Variant product must have at least one tier defined`,
      400,
    );
  }
};

/**
 * Validate variant model row
 */
const validateVariantModelRow = (row, rowIndex, tierCount) => {
  if (row.modelPrice === undefined || row.modelPrice === "") {
    throw new ErrorResponse(`Row ${rowIndex}: Model price is required`, 400);
  }
  if (isNaN(parseFloat(row.modelPrice))) {
    throw new ErrorResponse(
      `Row ${rowIndex}: Model price must be a number`,
      400,
    );
  }
  if (row.modelStock === undefined || row.modelStock === "") {
    throw new ErrorResponse(`Row ${rowIndex}: Model stock is required`, 400);
  }
  if (isNaN(parseInt(row.modelStock))) {
    throw new ErrorResponse(
      `Row ${rowIndex}: Model stock must be a number`,
      400,
    );
  }

  // Check tierValue columns exist
  for (let i = 0; i < tierCount; i++) {
    const tierValueKey = `tierValue${i + 1}`;
    if (!row[tierValueKey] || !row[tierValueKey].trim()) {
      throw new ErrorResponse(
        `Row ${rowIndex}: ${tierValueKey} is required`,
        400,
      );
    }
  }
};

/**
 * Transform grouped rows into structured product objects
 * Handles both single and variant products
 *
 * @param {Array} records - CSV records from parseCSVBuffer
 * @returns {Array} Product objects — categoryId luôn null (AI + UI sau)
 */
export const transformRowsToProducts = (records) => {
  if (!records || records.length === 0) {
    throw new ErrorResponse("No records found in CSV", 400);
  }

  const products = [];
  let i = 0;

  while (i < records.length) {
    const row = records[i];
    const productType = row.productType?.toLowerCase().trim();

    if (!productType) {
      throw new ErrorResponse(
        `Row ${i + 1}: productType is required (single or variant)`,
        400,
      );
    }

    if (productType === "single") {
      // Single product: one row = one product
      validateSingleProductRow(row, i + 1);

      const price = parseFloat(row.price);
      const stock = parseInt(row.stock);
      const costPrice = row.costPrice ? parseFloat(row.costPrice) : 0;
      const weight = row.weight ? parseFloat(row.weight) : 0;

      // Validate non-negative values
      if (price < 0) {
        throw new ErrorResponse(`Row ${i + 1}: Price cannot be negative`, 400);
      }
      if (stock < 0) {
        throw new ErrorResponse(`Row ${i + 1}: Stock cannot be negative`, 400);
      }
      if (weight < 0) {
        throw new ErrorResponse(`Row ${i + 1}: Weight cannot be negative`, 400);
      }

      const product = {
        name: row.name.trim(),
        categoryId: null,
        description: row.description?.trim() || "",
        brand: row.brand?.trim() || null,
        /* Bulk không có ảnh — luôn draft (cột status trong file bị bỏ qua). */
        status: "draft",
        models: [
          {
            sku: row.sku?.trim() || null,
            price,
            costPrice,
            stock,
            tierIndex: [],
            weight,
            weightUnit: row.weightUnit?.toLowerCase() || "gr",
          },
        ],
      };

      products.push(product);
      i++;
    } else if (productType === "variant") {
      // Variant product: first row = header with tiers, subsequent rows = models
      validateVariantProductRow(row, i + 1);

      const tiers = extractTiersFromRow(row);
      const models = [];

      // Scan ahead for model rows (rows that start with "model" prefix or have tierValue columns)
      i++;
      while (i < records.length) {
        const modelRow = records[i];
        const nextProductType = modelRow.productType?.toLowerCase().trim();

        // Stop if we hit another product header
        if (nextProductType === "single" || nextProductType === "variant") {
          break;
        }

        // Dòng model: có modelPrice/modelSku hoặc cột phân tầng tierValue*
        const hasModelFields =
          modelRow.modelSku ||
          modelRow.modelPrice !== undefined ||
          modelRow.modelStock !== undefined ||
          Object.keys(modelRow).some((key) => key.startsWith("tierValue"));

        if (!hasModelFields) {
          i++;
          continue;
        }

        // Validate model row
        validateVariantModelRow(modelRow, i + 1, tiers.length);

        const tierIndex = findTierIndexFromValues(tiers, modelRow);
        const price = parseFloat(modelRow.modelPrice);
        const stock = parseInt(modelRow.modelStock);
        const costPrice = modelRow.modelCostPrice
          ? parseFloat(modelRow.modelCostPrice)
          : 0;
        const weight = modelRow.modelWeight
          ? parseFloat(modelRow.modelWeight)
          : 0;

        // Validate non-negative values
        if (price < 0) {
          throw new ErrorResponse(
            `Row ${i + 1}: Model price cannot be negative`,
            400,
          );
        }
        if (stock < 0) {
          throw new ErrorResponse(
            `Row ${i + 1}: Model stock cannot be negative`,
            400,
          );
        }
        if (weight < 0) {
          throw new ErrorResponse(
            `Row ${i + 1}: Model weight cannot be negative`,
            400,
          );
        }

        models.push({
          sku: modelRow.modelSku?.trim() || null,
          price,
          costPrice,
          stock,
          tierIndex,
          weight,
          weightUnit: modelRow.modelWeightUnit?.toLowerCase() || "gr",
        });

        i++;
      }

      if (models.length === 0) {
        throw new ErrorResponse(
          `Variant product at row ${i + 1} has no models defined`,
          400,
        );
      }

      const product = {
        name: row.name.trim(),
        categoryId: null,
        description: row.description?.trim() || "",
        brand: row.brand?.trim() || null,
        /* Bulk không có ảnh — luôn draft (cột status trong file bị bỏ qua). */
        status: "draft",
        tiers,
        models,
      };

      products.push(product);
    } else {
      throw new ErrorResponse(
        `Row ${i + 1}: productType must be 'single' or 'variant', got '${productType}'`,
        400,
      );
    }
  }

  // Validate no duplicate SKUs across all products
  const allSkus = products.flatMap((p) =>
    p.models.map((m) => m.sku).filter((s) => s !== null),
  );
  const uniqueSkus = new Set(allSkus);
  if (uniqueSkus.size < allSkus.length) {
    const duplicates = allSkus.filter(
      (sku, idx) => allSkus.indexOf(sku) !== idx,
    );
    throw new ErrorResponse(
      `Duplicate SKUs found in CSV: ${[...new Set(duplicates)].join(", ")}`,
      400,
    );
  }

  return products;
};

/**
 * Parse CSV hoặc Excel → products
 * @param {Buffer} buffer
 * @param {string} [originalName] — tên file để chọn parser (.csv vs .xlsx)
 */
export const parseBulkUploadFile = (buffer, originalName = "") => {
  const name = (originalName || "").toLowerCase();
  let raw;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    raw = parseExcelBuffer(buffer);
  } else {
    raw = parseCSVBuffer(buffer);
  }
  const records = raw.map(normalizeRecord).filter((r) => !isEmptyRow(r));
  if (records.length === 0) {
    throw new ErrorResponse("No data rows found in file", 400);
  }
  return transformRowsToProducts(records);
};

/** @deprecated dùng parseBulkUploadFile — giữ tương thích */
export const parseBulkUploadCSV = (buffer) => parseBulkUploadFile(buffer, ".csv");
