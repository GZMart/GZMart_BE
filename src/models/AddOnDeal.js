import mongoose from "mongoose";

const addOnDealSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Promotion name is required"],
      trim: true,
      maxlength: 100,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    purchaseLimit: {
      type: Number,
      default: 0, // 0 means unlimited
      min: 0,
    },
    // Main products (Prerequisites)
    mainProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    // Add-on products (Discounted items)
    subProducts: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        modelId: {
          type: mongoose.Schema.Types.ObjectId,
          required: false, // Optional for backward compatibility, but recommended
        },
        price: {
          type: Number,
          required: true,
          min: 0,
        },
        limit: {
          type: Number, // Max qty allowed per order for this item
          default: 1,
          min: 1,
        },
        _id: false,
      },
    ],
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
addOnDealSchema.index({ sellerId: 1, status: 1 });
addOnDealSchema.index({ startDate: 1, endDate: 1 });

// Pre-save status update
addOnDealSchema.pre("save", async function () {
  if (this.status === "cancelled") return;

  const now = new Date();
  if (now < this.startDate) {
    this.status = "upcoming";
  } else if (now >= this.startDate && now <= this.endDate) {
    this.status = "active";
  } else if (now > this.endDate) {
    this.status = "ended";
  }
});

// Validation
addOnDealSchema.pre("validate", async function () {
  if (this.startDate && this.endDate && this.startDate >= this.endDate) {
    this.invalidate("endDate", "End date must be after start date");
  }
});

const AddOnDeal = mongoose.model("AddOnDeal", addOnDealSchema);
export default AddOnDeal;
