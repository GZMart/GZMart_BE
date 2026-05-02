import ExcelJS from "exceljs";
import { getTemplateTable } from "./bulkUploadCsvRows.js";

const HEADER_FILL = "FF1A56DB";
const BORDER = "FFBDC7D3";
const DATA_FONT = "FF0F172A";

const thinBorder = {
  top: { style: "thin", color: { argb: BORDER } },
  left: { style: "thin", color: { argb: BORDER } },
  bottom: { style: "thin", color: { argb: BORDER } },
  right: { style: "thin", color: { argb: BORDER } },
};

/**
 * File .xlsx mẫu: header tô màu, viền, freeze hàng 1, cột tự rộng + sheet hướng dẫn.
 * @param {'single'|'variant'|'mixed'} type
 * @returns {Promise<Buffer>}
 */
export async function buildStyledExcelTemplateBuffer(type) {
  const rows = getTemplateTable(type);

  const wb = new ExcelJS.Workbook();
  wb.creator = "GZMart";
  wb.created = new Date();

  const ws = wb.addWorksheet("Dữ liệu", {
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });

  rows.forEach((rowVals, rowIdx) => {
    const excelRow = ws.getRow(rowIdx + 1);
    rowVals.forEach((raw, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const str = raw === null || raw === undefined ? "" : String(raw);
      cell.value = str === "" ? null : str;
      cell.border = thinBorder;

      if (rowIdx === 0) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: HEADER_FILL },
        };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.alignment = {
          vertical: "middle",
          horizontal: "left",
          wrapText: true,
        };
      } else {
        cell.font = { size: 11, color: { argb: DATA_FONT } };
        cell.alignment = { vertical: "top", wrapText: true };
      }
    });
    if (rowIdx === 0) {
      excelRow.height = 22;
    }
  });

  const numCols = rows[0].length;
  for (let c = 1; c <= numCols; c++) {
    let maxLen = 10;
    rows.forEach((r) => {
      const v = r[c - 1];
      const len = v != null && v !== "" ? String(v).length : 0;
      maxLen = Math.max(maxLen, len);
    });
    ws.getColumn(c).width = Math.min(45, Math.max(11, maxLen + 2));
  }

  const guide = wb.addWorksheet("Hướng dẫn");
  guide.getColumn(1).width = 96;

  guide.getCell(1, 1).value = "Mẫu tải lên sản phẩm hàng loạt (GZMart)";
  guide.getCell(1, 1).font = { bold: true, size: 14, color: { argb: DATA_FONT } };

  const bullets = [
    'Nhập / sửa dữ liệu ở sheet "Dữ liệu". Không đổi tên các cột ở hàng 1 (header).',
    "Không có cột danh mục trong file — sau khi upload, hệ thống gợi ý danh mục bằng AI từ tên + mô tả; bạn xác nhận trên màn hình.",
    "single: một dòng một sản phẩm. variant: một dòng đầu (productType=variant) kèm tier, các dòng sau là biến thể (để trống cột productType).",
    "Giữ định dạng số cho price/stock; phân tầng tier dùng dấu ; trong tierN_options.",
    "Lưu file và upload trong ứng dụng: Phân tích & xem trước → kiểm tra danh mục → Xác nhận.",
    "Không có cột trạng thái (status) trong mẫu — người bán không cần nhập; hệ thống luôn tạo sản phẩm ở bản nháp (draft).",
    "Sau xác nhận, sản phẩm được tạo ở trạng thái nháp (draft) vì chưa có ảnh; thêm ảnh và chỉnh trên màn hình sản phẩm rồi mới hiển thị (active).",
  ];

  bullets.forEach((text, i) => {
    const row = guide.getRow(i + 3);
    row.getCell(1).value = text;
    row.getCell(1).font = { size: 11, color: { argb: "FF475569" } };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
