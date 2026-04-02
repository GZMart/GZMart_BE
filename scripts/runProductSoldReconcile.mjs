import dotenv from "dotenv";
dotenv.config();

import connectDB from "../src/config/database.js";
import { runProductSoldReconcile } from "../src/jobs/productSoldReconcile.job.js";

const run = async () => {
  await connectDB();
  try {
    await runProductSoldReconcile();
    console.log("Reconcile job finished.");
  } catch (err) {
    console.error("Reconcile job error:", err);
  } finally {
    process.exit(0);
  }
};

run();

//node -e "import('./scripts/runProductSoldReconcile.mjs')"
