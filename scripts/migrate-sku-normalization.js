/**
 * Migration: Normalize all SKU fields in the database.
 *
 * Problem: SKUs containing Vietnamese accented characters (e.g. "GIÀY017-1-72C9")
 * were saved as-is. Subsequent operations using URL-decoded uppercase strings
 * (e.g. "GIÀY017-1-72C9") could not match the stored values after .toUpperCase(),
 * and different code paths used inconsistent normalization (with/without diacritics).
 *
 * Fix: Strip diacritics and uppercase all SKUs consistently.
 *
 * Run: node scripts/migrate-sku-normalization.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { normalizeSku } from "../src/utils/skuUtils.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error("❌  Set MONGO_URI (or MONGODB_URI) in .env before running.");
  process.exit(1);
}

// ── Inline schemas so this script has no import-time side-effects ──────────
const ProductSchema = new mongoose.Schema(
  {
    name: String,
    models: [
      {
        sku: { type: String, uppercase: true, trim: true },
        price: Number,
        costPrice: Number,
        stock: Number,
        tierIndex: [Number],
        images: [String],
      },
    ],
    status: String,
  },
  { strict: false },
);

const InventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, uppercase: true, trim: true },
    productId: mongoose.Schema.Types.ObjectId,
    modelId: mongoose.Schema.Types.ObjectId,
    quantity: Number,
    costPrice: Number,
    warehouseId: mongoose.Schema.Types.ObjectId,
  },
  { strict: false },
);

const InventoryTransactionSchema = new mongoose.Schema(
  {
    sku: { type: String, uppercase: true, trim: true },
    productId: mongoose.Schema.Types.ObjectId,
    modelId: mongoose.Schema.Types.ObjectId,
    quantity: Number,
    stockBefore: Number,
    stockAfter: Number,
    costPrice: Number,
    type: String,
    referenceType: String,
    referenceId: mongoose.Schema.Types.ObjectId,
    warehouseId: mongoose.Schema.Types.ObjectId,
    createdBy: mongoose.Schema.Types.ObjectId,
  },
  { strict: false },
);

const ProductModel = mongoose.model("Product", ProductSchema);
const InventoryItemModel = mongoose.model("InventoryItem", InventoryItemSchema);
const InventoryTransactionModel = mongoose.model(
  "InventoryTransaction",
  InventoryTransactionSchema,
);

// ── Helpers ──────────────────────────────────────────────────────────────────
/** True if the SKU contains non-ASCII letters (accented chars, etc.) */
function hasDiacritics(s) {
  return /[À-ÿ]/.test(s);
}

async function migrateCollection(Model, getSku, setSku, label) {
  const docs = await Model.find({}).lean();
  let updated = 0;

  for (const doc of docs) {
    let changed = false;
    const updates = {};

    for (const model of doc.models ?? []) {
      const raw = getSku(model);
      if (!raw) continue;
      const normalized = normalizeSku(raw);
      if (raw !== normalized) {
        setSku(model, normalized);
        changed = true;
      }
    }

    if (changed) {
      await Model.updateOne({ _id: doc._id }, { $set: { models: doc.models } });
      updated++;
      console.log(`  ✅  ${label} _id=${doc._id}`);
    }
  }

  return updated;
}

async function migrateSimpleCollection(Model, label) {
  const docs = await Model.find({}).lean();
  let updated = 0;

  for (const doc of docs) {
    const raw = doc.sku;
    if (!raw) continue;
    const normalized = normalizeSku(raw);
    if (raw !== normalized) {
      await Model.updateOne({ _id: doc._id }, { $set: { sku: normalized } });
      updated++;
      console.log(`  ✅  ${label} _id=${doc._id}  "${raw}" → "${normalized}"`);
    }
  }

  return updated;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔌  Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("✅  Connected.\n");

  console.log("📦  Step 1 – Products (models[].sku)...");
  const productUpdated = await migrateCollection(
    ProductModel,
    (m) => m.sku,
    (m, v) => (m.sku = v),
    "Product",
  );
  console.log(`   Updated ${productUpdated} products.\n`);

  console.log("📦  Step 2 – InventoryItems...");
  const invUpdated = await migrateSimpleCollection(InventoryItemModel, "InventoryItem");
  console.log(`   Updated ${invUpdated} inventory items.\n`);

  console.log("📦  Step 3 – InventoryTransactions...");
  const txUpdated = await migrateSimpleCollection(
    InventoryTransactionModel,
    "InventoryTransaction",
  );
  console.log(`   Updated ${txUpdated} transactions.\n`);

  // ── Dry-run summary ───────────────────────────────────────────────────────
  const total = productUpdated + invUpdated + txUpdated;
  if (total === 0) {
    console.log("✨  No SKUs needed normalization — already clean.");
  } else {
    console.log(`✅  Migration complete. ${total} document(s) updated.`);
    console.log(
      "\n⚠️  If any SKU mapping changed (e.g. GIÀY → GIAY), you may need\n" +
        "   to restart the server and re-test affected workflows.",
    );
  }

  await mongoose.disconnect();
  console.log("\n👋  Done.");
}

main().catch(async (err) => {
  console.error("❌  Migration failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
