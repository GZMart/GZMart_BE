import mongoose from "mongoose";

// Variant sub-schema
const variantSchema = new mongoose.Schema(
  {
    variantId: {
      type: String,
      required: true,
    },
    variantName: {
      type: String,
      default: "Default",
    },
    // Snapshot of original price at time of program creation
    originalPrice: {
      type: Number,
      required: [true, "Original price is required"],
      min: [0, "Original price cannot be negative"],
    },
    // Sale price for this program
    salePrice: {
      type: Number,
      required: [true, "Sale price is required"],
      min: [0, "Sale price cannot be negative"],
    },
    // Discount settings
    discount: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountType: {
      type: String,
      enum: ["fixed", "percent"],
      default: "fixed",
    },
    // Quantity limits
    promoQty: {
      type: Number,
      default: 0,
      min: [0, "Promo quantity cannot be negative"],
    },
    soldQty: {
      type: Number,
      default: 0,
      min: 0,
    },
    orderLimit: {
      type: Number,
      default: null,
      min: [1, "Order limit must be at least 1"],
    },
    // Enable/disable this variant in program
    enabled: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
);

const shopProgramProductSchema = new mongoose.Schema(
  {
    // References
    programId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShopProgram",
      required: [true, "Program ID is required"],
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Seller ID is required"],
    },

    // Product snapshot
    productName: {
      type: String,
      required: true,
    },
    productImage: {
      type: String,
      default: "",
    },

    // Variant-level settings
    variants: [variantSchema],

    // Derived status (synced with program)
    status: {
      type: String,
      enum: ["upcoming", "active", "ended", "cancelled"],
      default: "upcoming",
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
shopProgramProductSchema.index(
  { programId: 1, productId: 1 },
  { unique: true },
);
shopProgramProductSchema.index({ sellerId: 1, status: 1 });
shopProgramProductSchema.index({ productId: 1, status: 1 });

// Pre-save validation: salePrice < originalPrice for enabled variants
shopProgramProductSchema.pre("validate", async function () {
  for (const variant of this.variants) {
    if (variant.enabled) {
      if (variant.salePrice >= variant.originalPrice) {
        this.invalidate(
          "variants",
          `Variant "${variant.variantName}": Sale price must be less than original price`,
        );
      }
      if (variant.salePrice <= 0) {
        this.invalidate(
          "variants",
          `Variant "${variant.variantName}": Sale price must be greater than 0`,
        );
      }
      // Discount validation
      if (variant.discountType === "percent") {
        if (variant.discount < 1 || variant.discount > 99) {
          this.invalidate(
            "variants",
            `Variant "${variant.variantName}": Discount percentage must be between 1% and 99%`,
          );
        }
      } else {
        if (variant.discount >= variant.originalPrice) {
          this.invalidate(
            "variants",
            `Variant "${variant.variantName}": Discount amount must be less than original price`,
          );
        }
      }
    }
  }
});

// Static: Check if product is already in an overlapping program
shopProgramProductSchema.statics.checkOverlap = async function (
  productId,
  startDate,
  endDate,
  excludeProgramId = null,
) {
  const query = {
    productId,
    status: { $in: ["upcoming", "active"] },
  };
  if (excludeProgramId) {
    query.programId = { $ne: excludeProgramId };
  }

  const ShopProgram = mongoose.model("ShopProgram");
  const overlapping = await this.aggregate([
    { $match: query },
    {
      $lookup: {
        from: "shopprograms",
        localField: "programId",
        foreignField: "_id",
        as: "program",
      },
    },
    { $unwind: "$program" },
    {
      $match: {
        $or: [
          // New program starts during existing program
          {
            "program.startDate": { $lte: startDate },
            "program.endDate": { $gte: startDate },
          },
          // New program ends during existing program
          {
            "program.startDate": { $lte: endDate },
            "program.endDate": { $gte: endDate },
          },
          // New program completely contains existing program
          {
            "program.startDate": { $gte: startDate },
            "program.endDate": { $lte: endDate },
          },
        ],
      },
    },
  ]);

  return overlapping.length > 0 ? overlapping[0] : null;
};

const ShopProgramProduct = mongoose.model(
  "ShopProgramProduct",
  shopProgramProductSchema,
);

export default ShopProgramProduct;
