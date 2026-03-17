import * as dashboardService from "../../dashboard.service.js";
import { registerTool } from "../tools.js";

async function execute({ period = "monthly" } = {}) {
  const data = await dashboardService.getUserGrowth(period);

  const lines = data.map(
    (d) => `  ${d.period}: ${d.users} users (tích lũy)`
  );

  return { context: `=== TĂNG TRƯỞNG NGƯỜI DÙNG (${period}) ===\n${lines.join("\n")}` };
}

registerTool("userGrowth", {
  description: "Thống kê tăng trưởng người dùng (admin only)",
  roles: ["admin"],
  keywords: ["user", "người dùng", "tăng trưởng", "growth", "đăng ký", "registration"],
  execute,
});
