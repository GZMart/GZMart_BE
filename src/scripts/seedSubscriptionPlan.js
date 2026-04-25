import mongoose from "mongoose";
import dotenv from "dotenv";
import SubscriptionPlan from "../models/SubscriptionPlan.js";

dotenv.config();

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI");
    process.exit(1);
  }
  await mongoose.connect(uri);
  await SubscriptionPlan.findOneAndUpdate(
    { name: "GZMart VIP" },
    {
      name: "GZMart VIP",
      priceVnd: 99000,
      durationDays: 30,
      isActive: true,
      dailySlots: [
        {
          name: "VIP 15k hôm nay",
          discountType: "amount",
          discountValue: 15000,
          maxDiscountAmount: 15000,
          minBasketPrice: 0,
        },
        {
          name: "VIP 10% tối đa 20k",
          discountType: "percent",
          discountValue: 10,
          maxDiscountAmount: 20000,
          minBasketPrice: 100000,
        },
      ],
    },
    { upsert: true, new: true },
  );
  console.log("Seeded GZMart VIP");
  await mongoose.disconnect();
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
