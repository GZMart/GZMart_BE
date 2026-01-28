import mongoose from "mongoose";

const flashSaleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Flash sale title is required"],
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    // Status: upcoming, active, ended, cancelled
    status: {
      type: String,
      enum: {
        values: ["upcoming", "active", "ended", "cancelled"],
        message: "{VALUE} is not a valid status",
      },
      default: "upcoming",
    },
    banner: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
flashSaleSchema.index({ status: 1 });
flashSaleSchema.index({ startDate: 1, endDate: 1 });
flashSaleSchema.index({ createdAt: -1 });

// Pre-save: Update status based on current time
flashSaleSchema.pre("save", async function (next) {
  const now = new Date();
  if (now < this.startDate) {
    this.status = "upcoming";
  } else if (
    now >= this.startDate &&
    now <= this.endDate &&
    this.status !== "cancelled"
  ) {
    this.status = "active";
  } else if (now > this.endDate && this.status !== "cancelled") {
    this.status = "ended";
  }
  next();
});

const FlashSale = mongoose.model("FlashSale", flashSaleSchema);

export default FlashSale;
