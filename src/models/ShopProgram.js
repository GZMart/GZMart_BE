import mongoose from "mongoose";

const shopProgramSchema = new mongoose.Schema(
  {
    // Seller who created this program
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Seller ID is required"],
      index: true,
    },

    // Program name (internal, not shown to buyers)
    name: {
      type: String,
      required: [true, "Program name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },

    // Program duration
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },

    // Status management
    status: {
      type: String,
      enum: {
        values: ["draft", "upcoming", "active", "ended", "cancelled"],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
    },

    // Aggregated stats
    totalProducts: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalVariants: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
shopProgramSchema.index({ sellerId: 1, status: 1 });
shopProgramSchema.index({ startDate: 1, endDate: 1 });
shopProgramSchema.index({ status: 1, startDate: 1 });
shopProgramSchema.index({ createdAt: -1 });

// Pre-save: Auto-update status based on current time
shopProgramSchema.pre("save", async function () {
  // Only auto-update if not cancelled or draft
  if (this.status === "cancelled" || this.status === "draft") {
    return;
  }

  const now = new Date();
  if (now < this.startDate) {
    this.status = "upcoming";
  } else if (now >= this.startDate && now <= this.endDate) {
    this.status = "active";
  } else if (now > this.endDate) {
    this.status = "ended";
  }
});

// Validation: endDate must be after startDate
shopProgramSchema.pre("validate", async function () {
  if (this.startDate && this.endDate) {
    if (this.endDate <= this.startDate) {
      this.invalidate("endDate", "End date must be after start date");
    }
    // Minimum duration: 1 hour
    const duration = this.endDate - this.startDate;
    const oneHour = 60 * 60 * 1000;
    if (duration < oneHour) {
      this.invalidate("endDate", "Program duration must be at least 1 hour");
    }
    // Maximum duration: 30 days
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    if (duration > thirtyDays) {
      this.invalidate("endDate", "Program duration cannot exceed 30 days");
    }
  }
});

// Static method: Update status for all programs
shopProgramSchema.statics.syncAllStatuses = async function () {
  const now = new Date();

  // Update upcoming → active
  await this.updateMany(
    {
      status: "upcoming",
      startDate: { $lte: now },
      endDate: { $gt: now },
    },
    { status: "active" },
  );

  // Update active/upcoming → ended
  await this.updateMany(
    {
      status: { $in: ["upcoming", "active"] },
      endDate: { $lte: now },
    },
    { status: "ended" },
  );
};

const ShopProgram = mongoose.model("ShopProgram", shopProgramSchema);

export default ShopProgram;
