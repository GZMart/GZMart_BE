import mongoose from "mongoose";
import Category from "../models/Category.js";
import { ErrorResponse } from "../utils/errorResponse.js";

const is24Hex = (s) => /^[a-fA-F0-9]{24}$/.test(String(s));

/**
 * Map Mongo id hoặc slug → category _id string (active).
 * @param {string|null|undefined} raw
 * @returns {Promise<string|null>}
 */
export async function resolveCategoryInput(raw) {
  if (raw == null || String(raw).trim() === "") {
    return null;
  }
  const s = String(raw).trim();

  if (is24Hex(s) && mongoose.Types.ObjectId.isValid(s)) {
    const cat = await Category.findOne({ _id: s, status: "active" })
      .select("_id")
      .lean();
    if (!cat) {
      throw new ErrorResponse(`Không tìm thấy danh mục với id: ${s}`, 400);
    }
    return String(cat._id);
  }

  const slug = s.toLowerCase();
  const cat = await Category.findOne({ slug, status: "active" })
    .select("_id")
    .lean();
  if (!cat) {
    throw new ErrorResponse(`Không tìm thấy danh mục (slug): ${s}`, 400);
  }
  return String(cat._id);
}
