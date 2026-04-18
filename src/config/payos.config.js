import PayOSPackage from "@payos/node";

// PayOS package export như { PayOS: class }
const PayOS = PayOSPackage.PayOS || PayOSPackage.default?.PayOS || PayOSPackage;

let payOs = null;
let payOsPayout = null;

const createPayOsClient = ({ clientId, apiKey, checksumKey, label }) => {
  if (!clientId || !apiKey || !checksumKey) {
    return null;
  }

  const client = new PayOS({
    clientId,
    apiKey,
    checksumKey,
  });

  console.log(`[PayOS Config] ${label} initialized successfully`);
  return client;
};

try {
  const {
    PAYOS_CLIENT_ID,
    PAYOS_API_KEY,
    PAYOS_CHECKSUM_KEY,
    PAYOS_PAYOUT_CLIENT_ID,
    PAYOS_PAYOUT_API_KEY,
    PAYOS_PAYOUT_CHECKSUM_KEY,
  } = process.env;

  payOs = createPayOsClient({
    clientId: PAYOS_CLIENT_ID,
    apiKey: PAYOS_API_KEY,
    checksumKey: PAYOS_CHECKSUM_KEY,
    label: "PayOS payment client",
  });

  if (!payOs) {
    console.error("[PayOS Config] Missing default payment credentials in .env");
  }

  payOsPayout = createPayOsClient({
    clientId: PAYOS_PAYOUT_CLIENT_ID,
    apiKey: PAYOS_PAYOUT_API_KEY,
    checksumKey: PAYOS_PAYOUT_CHECKSUM_KEY,
    label: "PayOS payout client",
  });

  if (!payOsPayout) {
    console.error("[PayOS Config] Missing payout credentials in .env");
  }
} catch (error) {
  console.error("[PayOS Config] Error:", error.message);
}

export default payOs;
export { payOsPayout };

export const isPayOsConfigured = () => Boolean(payOs);
export const isPayOsPayoutConfigured = () => Boolean(payOsPayout);
