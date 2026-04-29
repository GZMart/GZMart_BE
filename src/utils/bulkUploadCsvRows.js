/**
 * Cột chuẩn bulk upload — không có cột danh mục (AI gợi ý sau) và không có cột status (luôn tạo draft).
 * Dùng chung cho CSV và Excel mẫu (định dạng đẹp).
 */

export const BULK_UPLOAD_HEADERS = [
  "productType",
  "name",
  "brand",
  "description",
  "tier1_name",
  "tier1_options",
  "tier2_name",
  "tier2_options",
  "tier3_name",
  "tier3_options",
  "sku",
  "price",
  "stock",
  "costPrice",
  "weight",
  "weightUnit",
  "modelSku",
  "modelPrice",
  "modelStock",
  "modelCostPrice",
  "modelWeight",
  "modelWeightUnit",
  "tierValue1",
  "tierValue2",
  "tierValue3",
];

const COL_COUNT = BULK_UPLOAD_HEADERS.length;

/** Số cột từ productType → weightUnit (để trống trên dòng model variant) — không còn cột status. */
const MODEL_PREFIX = () => Array(16).fill("");

const escapeCsv = (field) => {
  const s = field == null ? "" : String(field);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export const bulkCsvRow = (values) => {
  if (values.length !== COL_COUNT) {
    throw new Error(
      `bulkCsvRow: expected ${COL_COUNT} columns, got ${values.length}`,
    );
  }
  return values.map(escapeCsv).join(",");
};

/* ─── Dữ liệu mẫu (ma trận: hàng 0 = header) ─── */

const ROW_SINGLE_1 = [
  "single",
  "Example Product 1",
  "Brand Name",
  "Product description here",
  "",
  "",
  "",
  "",
  "",
  "",
  "SKU-001",
  "99000",
  "150",
  "50000",
  "200",
  "gr",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const ROW_SINGLE_2 = [
  "single",
  "Example Product 2",
  "Brand Name",
  "Another product",
  "",
  "",
  "",
  "",
  "",
  "",
  "SKU-002",
  "129000",
  "100",
  "65000",
  "250",
  "gr",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const ROW_SINGLE_3 = [
  "single",
  "Example Product 3",
  "Brand Name",
  "Third product",
  "",
  "",
  "",
  "",
  "",
  "",
  "SKU-003",
  "79000",
  "200",
  "40000",
  "180",
  "gr",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const ROW_VARIANT_MAIN = [
  "variant",
  "Premium Cotton T-Shirt",
  "Nike",
  "High quality cotton",
  "Size",
  "S;M;L;XL",
  "Color",
  "Red;Blue;Black",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const VARIANT_MODEL_ROWS = [
  [...MODEL_PREFIX(), "TSH-S-RED-001", "99000", "50", "50000", "200", "gr", "S", "Red", ""],
  [...MODEL_PREFIX(), "TSH-S-BLUE-001", "99000", "45", "50000", "200", "gr", "S", "Blue", ""],
  [...MODEL_PREFIX(), "TSH-M-RED-001", "109000", "60", "55000", "210", "gr", "M", "Red", ""],
  [...MODEL_PREFIX(), "TSH-M-BLUE-001", "109000", "55", "55000", "210", "gr", "M", "Blue", ""],
  [...MODEL_PREFIX(), "TSH-L-RED-001", "119000", "40", "60000", "220", "gr", "L", "Red", ""],
  [...MODEL_PREFIX(), "TSH-XL-BLACK-001", "129000", "0", "65000", "230", "gr", "XL", "Black", ""],
];

const ROW_MIXED_SINGLE = [
  "single",
  "Basic T-Shirt",
  "Nike",
  "Plain tee",
  "",
  "",
  "",
  "",
  "",
  "",
  "TSH-BASIC",
  "79000",
  "500",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const ROW_MIXED_VARIANT = [
  "variant",
  "Premium T-Shirt",
  "Nike",
  "Two tiers",
  "Size",
  "S;M;L",
  "Color",
  "Red;Blue",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

const MIXED_MODEL_ROWS = [
  [...MODEL_PREFIX(), "TSH-PREM-S-RED", "99000", "50", "", "", "", "S", "Red", ""],
  [...MODEL_PREFIX(), "TSH-PREM-M-BLUE", "109000", "60", "", "", "", "M", "Blue", ""],
  [...MODEL_PREFIX(), "TSH-PREM-L-RED", "119000", "40", "", "", "", "L", "Red", ""],
];

/**
 * Ma trận đầy đủ: [header, ...data] — dùng cho Excel styling.
 * @param {'single'|'variant'|'mixed'} type
 * @returns {string[][]}
 */
export const getTemplateTable = (type) => {
  const header = [...BULK_UPLOAD_HEADERS];
  if (type === "single") {
    return [header, ROW_SINGLE_1, ROW_SINGLE_2, ROW_SINGLE_3];
  }
  if (type === "variant") {
    return [header, ROW_VARIANT_MAIN, ...VARIANT_MODEL_ROWS];
  }
  if (type === "mixed") {
    return [header, ROW_MIXED_SINGLE, ROW_MIXED_VARIANT, ...MIXED_MODEL_ROWS];
  }
  throw new Error(`Unknown template type: ${type}`);
};

export const buildSingleTemplate = () =>
  getTemplateTable("single").map(bulkCsvRow).join("\r\n");

export const buildVariantTemplate = () =>
  getTemplateTable("variant").map(bulkCsvRow).join("\r\n");

export const buildMixedTemplate = () =>
  getTemplateTable("mixed").map(bulkCsvRow).join("\r\n");
