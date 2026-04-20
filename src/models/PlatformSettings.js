import mongoose from "mongoose";

/**
 * Singleton document for editable platform / ops settings (admin UI).
 * Not a substitute for secrets — keep keys in env.
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "default",
      unique: true,
      immutable: true,
    },
    maintenanceMode: {
      type: Boolean,
      default: false,
    },
    maintenanceMessage: {
      type: String,
      default: "",
      trim: true,
    },
    siteDisplayName: {
      type: String,
      default: "GZMart",
      trim: true,
    },
    supportEmail: {
      type: String,
      default: "",
      trim: true,
    },
    supportPhone: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("PlatformSettings", platformSettingsSchema);
