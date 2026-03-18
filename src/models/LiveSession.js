import mongoose from "mongoose";

const liveSessionSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, trim: true, default: "Live stream" },
    status: {
      type: String,
      enum: ["scheduled", "live", "ended", "cancelled"],
      default: "scheduled",
      index: true,
    },
    liveKitRoomName: { type: String, trim: true, unique: true, sparse: true },
    liveKitToken: { type: String, select: false },
    startedAt: { type: Date },
    endedAt: { type: Date },
    viewerCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

liveSessionSchema.index({ shopId: 1, status: 1 });

export default mongoose.model("LiveSession", liveSessionSchema);
