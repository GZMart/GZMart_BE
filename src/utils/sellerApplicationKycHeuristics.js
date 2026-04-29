/** @typedef {{ code: string, passed: boolean, detail: string }} KycCheck */
/** @typedef {import('../services/vietqrCitizen.service.js').CitizenLookupResult} CitizenLookupResult */

const DIGITS_ONLY = /^\d+$/;

/**
 * @param {object} input
 * @param {string} [input.phone]
 * @param {string} [input.citizenId]
 * @param {string} [input.taxId]
 * @returns {{ allPassed: boolean, checks: KycCheck[] }}
 */
export function runLocalKycChecks(input = {}) {
  const checks = [];

  const phone = (input.phone || "").trim();
  const phoneOk = /^[0-9]{10,11}$/.test(phone);
  checks.push({
    code: "phone_format",
    passed: phoneOk,
    detail: phoneOk ? "OK" : "Số điện thoại VN cần 10–11 chữ số",
  });

  const cid = (input.citizenId || "").replace(/\s/g, "");
  const cidDigits = DIGITS_ONLY.test(cid) && (cid.length === 9 || cid.length === 12);
  checks.push({
    code: "citizen_id_format",
    passed: cidDigits,
    detail: cidDigits ? "OK" : "CCCD 12 số hoặc CMND cũ 9 số (chỉ chữ số)",
  });

  const taxRaw = (input.taxId || "").replace(/[-\s]/g, "");
  const taxOk = DIGITS_ONLY.test(taxRaw) && taxRaw.length >= 10 && taxRaw.length <= 13;
  checks.push({
    code: "tax_id_format",
    passed: taxOk,
    detail: taxOk ? "OK" : "MST (chữ số) thường 10–13 ký tự sau khi bỏ dấu gạch",
  });

  return {
    allPassed: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * Chuyển kết quả VietQR API thành KycCheck chuẩn để đưa vào prompt.
 *
 * @param {VietQrLookupResult} result
 * @returns {KycCheck}
 */
export function formatVietQrCheck(result) {
  if (!result.checked) {
    return {
      code: "tax_api_verify",
      passed: false,
      detail: `Hệ thống bỏ qua tra cứu VietQR: ${result.desc}`,
    };
  }

  if (result.matched === true) {
    return {
      code: "tax_api_verify",
      passed: true,
      detail: `VietQR: Mã số thuế hợp lệ và đang hoạt động trên hệ thống.`,
    };
  }

  if (result.matched === false) {
    return {
      code: "tax_api_verify",
      passed: false,
      detail: `VietQR: Không tìm thấy thông tin doanh nghiệp cho Mã số thuế này.`,
    };
  }

  // matched === null (timeout / parse error)
  return {
    code: "tax_api_verify",
    passed: false,
    detail: `VietQR: Trả về kết quả không xác định (code: ${result.code} - ${result.desc})`,
  };
}
