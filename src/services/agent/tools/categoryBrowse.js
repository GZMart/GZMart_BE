import Category from "../../../models/Category.js";
import { registerTool } from "../tools.js";

async function execute({ parentId } = {}) {
  const filter = { status: "active" };
  if (parentId) filter.parentId = parentId;

  const categories = await Category.find(filter)
    .select("name slug parentId level productCount")
    .sort({ productCount: -1 })
    .lean();

  const allCats = await Category.find({ status: "active" }).select("name").lean();
  const catMap = {};
  allCats.forEach((c) => { catMap[c._id.toString()] = c.name; });

  const lines = categories.map((c) => {
    const parent = c.parentId ? catMap[c.parentId.toString()] : null;
    return `- ${c.name}${parent ? ` (thuộc ${parent})` : ""} — ${c.productCount} sản phẩm`;
  });

  return { context: `=== DANH MỤC SẢN PHẨM (${categories.length}) ===\n${lines.join("\n")}` };
}

registerTool("categoryBrowse", {
  description: "Xem danh sách danh mục sản phẩm",
  roles: ["buyer", "seller", "admin"],
  keywords: ["danh mục", "category", "loại", "phân loại", "thể loại", "có gì", "bán gì"],
  execute,
});
