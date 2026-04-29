/**
 * VietQR Lookup Service
 *
 * Tra cứu thông tin qua API của VietQR.
 * Hiện tại chỉ hỗ trợ tra cứu Mã số thuế doanh nghiệp.
 * Fallback hoàn toàn: mọi lỗi đều trả về { checked: false } thay vì throw.
 */

const VIETQR_BUSINESS_URL = "https://api.vietqr.io/v2/business";
const TIMEOUT_MS = 5_000;

/**
 * @typedef {Object} VietQrLookupResult
 * @property {boolean}      checked   - Có gọi được API không (false = skipped / error)
 * @property {boolean|null} matched   - true = tìm thấy, false = không khớp, null = không xác định
 * @property {string}       code      - Response code từ VietQR ("00" = success)
 * @property {string}       desc      - Mô tả từ VietQR
 * @property {object|null}  rawData   - data payload gốc từ VietQR (nếu có)
 * @property {string|null}  error     - Chuỗi lỗi kỹ thuật (nếu có)
 */

/**
 * Tra cứu thông tin doanh nghiệp qua VietQR API (dùng cho Mã số thuế).
 *
 * @param {{ taxCode: string }} params
 * @returns {Promise<VietQrLookupResult>}
 */
export async function lookupBusiness({ taxCode }) {
  const id = (taxCode || "").replace(/\s/g, "").trim();

  if (!id) {
    return _skipped("vietqr_missing_input");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${VIETQR_BUSINESS_URL}/${encodeURIComponent(id)}`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
    });

    clearTimeout(timer);

    const rawText = await response.text().catch(() => "");

    // --- HTTP-level error handling ---
    if (!response.ok) {
      if (response.status === 429) return _skipped("vietqr_rate_limited");
      if (response.status === 401 || response.status === 403) return _skipped("vietqr_auth_error");
      if (response.status >= 500) return _skipped(`vietqr_server_error_${response.status}`);

      return {
        checked: true,
        matched: null,
        code: String(response.status),
        desc: `VietQR phản hồi HTTP ${response.status}`,
        rawData: null,
        error: `http_${response.status}`,
      };
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch {
      return {
        checked: true,
        matched: null,
        code: "parse_error",
        desc: "Không đọc được JSON từ VietQR",
        rawData: null,
        error: "parse_error",
      };
    }

    const code = String(json?.code ?? "");
    const desc = String(json?.desc ?? "");
    const rawData = json?.data ?? null;

    // "00" = Success — VietQR xác nhận tìm thấy bản ghi khớp
    if (code === "00") {
      return { checked: true, matched: true, code, desc, rawData, error: null };
    }

    return {
      ..._skipped(`vietqr_code_${code}`),
      desc: desc || `VietQR trả code ${code} (không rõ ý nghĩa)`,
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err?.name === "AbortError";
    return {
      checked: false,
      matched: null,
      code: isTimeout ? "timeout" : "request_error",
      desc: isTimeout ? "VietQR API timeout (>5s)" : "Lỗi kết nối VietQR",
      rawData: null,
      error: err?.message ?? "unknown_error",
    };
  }
}

/** @returns {VietQrLookupResult} */
function _skipped(reason) {
  const descriptions = {
    vietqr_not_configured: "VietQR chưa cấu hình (thiếu VIETQR_CLIENT_ID / VIETQR_API_KEY)",
    vietqr_missing_input:  "Bỏ qua tra cứu: dữ liệu đầu vào trống",
    vietqr_rate_limited:   "VietQR giới hạn tốc độ (429 Too Many Requests) — bỏ qua lần này",
    vietqr_auth_error:     "VietQR từ chối xác thực (401/403) — kiểm tra lại API key",
  };
  return {
    checked: false,
    matched: null,
    code: reason,
    desc: descriptions[reason] ?? `Không thể tra cứu từ hệ thống VietQR lúc này.`,
    rawData: null,
    error: null,
  };
}
