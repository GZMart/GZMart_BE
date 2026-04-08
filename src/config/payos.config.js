import PayOSPackage from "@payos/node";

// PayOS package export như { PayOS: class }
const PayOS = PayOSPackage.PayOS || PayOSPackage.default?.PayOS || PayOSPackage;

let payOs = null;

try {
  const { PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY } = process.env;

  if (!PAYOS_CLIENT_ID || !PAYOS_API_KEY || !PAYOS_CHECKSUM_KEY) {
    console.error("[PayOS Config] Missing credentials in .env");
  } else {
    payOs = new PayOS({
      clientId: PAYOS_CLIENT_ID,
      apiKey: PAYOS_API_KEY,
      checksumKey: PAYOS_CHECKSUM_KEY,
    });
    console.log("[PayOS Config] PayOS initialized successfully");
  }
} catch (error) {
  console.error("[PayOS Config] Error:", error.message);
}

export default payOs;

export const isPayOsConfigured = () => Boolean(payOs);
