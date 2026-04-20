import User from "../models/User.js";

/**
 * Escape chuỗi dùng trong MongoDB $regex (an toàn, tránh ReDoS do input ngắn + giới hạn kết quả ở caller).
 */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chỉ giữ chữ số — dùng so khớp SĐT lưu trong DB (10–11 số). */
export function normalizePhoneDigits(input) {
  return String(input || "").replace(/\D/g, "");
}

/**
 * Các biến thể SĐT VN thường gặp khi CS nhập (090…, 84…, 9…).
 */
function vietnamPhoneCandidates(rawDigits) {
  const d = rawDigits;
  const out = new Set();
  if (!d) return out;
  out.add(d);
  if (d.startsWith("84") && d.length >= 10) {
    out.add(`0${d.slice(2)}`);
  }
  if (d.startsWith("0") && d.length >= 10) {
    out.add(`84${d.slice(1)}`);
  }
  if (!d.startsWith("0") && !d.startsWith("84") && d.length === 9) {
    out.add(`0${d}`);
  }
  return [...out];
}

const MAX_USER_MATCH = 200;

/**
 * Tìm user theo chuỗi vận hành TMĐT: email, SĐT, họ tên (partial, không phân biệt hoa thường).
 * Không yêu cầu người dùng nhập ObjectId.
 *
 * @param {string} raw
 * @param {{ roles?: string[] }} [options] - ví dụ ['seller'] khi lọc shop
 * @returns {Promise<import('mongoose').Types.ObjectId[]|null>} null nếu bỏ qua (chuỗi quá ngắn); [] nếu không ai khớp
 */
export async function findUserIdsBySearch(raw, options = {}) {
  const q = String(raw || "").trim();
  if (q.length < 2) {
    return null;
  }

  const or = [
    { fullName: { $regex: escapeRegex(q), $options: "i" } },
    { email: { $regex: escapeRegex(q), $options: "i" } },
  ];

  const digits = normalizePhoneDigits(q);
  if (digits.length >= 9 && digits.length <= 12) {
    for (const phone of vietnamPhoneCandidates(digits)) {
      if (phone.length >= 9 && phone.length <= 12) {
        or.push({ phone });
      }
    }
  }

  const filter = { $or: or };
  if (options.roles?.length) {
    filter.role = { $in: options.roles };
  }

  const users = await User.find(filter).select("_id").limit(MAX_USER_MATCH).lean();
  return users.map((u) => u._id);
}
