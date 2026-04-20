import { asyncHandler } from "../middlewares/async.middleware.js";
import PlatformSettings from "../models/PlatformSettings.js";

const DEFAULT_KEY = "default";

/**
 * @desc    Get platform settings (admin)
 * @route   GET /api/platform-settings
 */
export const getPlatformSettings = asyncHandler(async (req, res) => {
  let doc = await PlatformSettings.findOne({ singletonKey: DEFAULT_KEY });
  if (!doc) {
    doc = await PlatformSettings.create({ singletonKey: DEFAULT_KEY });
  }
  res.status(200).json({ success: true, data: doc });
});

/**
 * @desc    Update platform settings (admin)
 * @route   PUT /api/platform-settings
 */
export const updatePlatformSettings = asyncHandler(async (req, res) => {
  const {
    maintenanceMode,
    maintenanceMessage,
    siteDisplayName,
    supportEmail,
    supportPhone,
  } = req.body;

  const update = {};
  if (typeof maintenanceMode === "boolean") update.maintenanceMode = maintenanceMode;
  if (maintenanceMessage !== undefined) update.maintenanceMessage = String(maintenanceMessage);
  if (siteDisplayName !== undefined) update.siteDisplayName = String(siteDisplayName).trim();
  if (supportEmail !== undefined) update.supportEmail = String(supportEmail).trim();
  if (supportPhone !== undefined) update.supportPhone = String(supportPhone).trim();

  const doc = await PlatformSettings.findOneAndUpdate(
    { singletonKey: DEFAULT_KEY },
    { $set: update, $setOnInsert: { singletonKey: DEFAULT_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.status(200).json({ success: true, data: doc });
});
