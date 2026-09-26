import crypto from 'node:crypto';
import fetch from 'node-fetch';

const NOWPAYMENTS_BASE_URL = 'https://api.nowpayments.io/v1';

/**
 * Creates a NOWPayments invoice for an arbitrary agreed amount.
 * orderId should be the Firestore paymentRequests document ID, so the
 * webhook handler can update the exact same document without a search.
 */
export async function createInvoice({ orderId, amount, currency, description, ipnCallbackUrl }) {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) {
    throw new Error('NOWPAYMENTS_API_KEY is not set.');
  }

  const response = await fetch(`${NOWPAYMENTS_BASE_URL}/invoice`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      price_amount: amount,
      price_currency: currency,
      order_id: orderId,
      order_description: description,
      ipn_callback_url: ipnCallbackUrl
    })
  });

  const body = await response.json();

  if (!response.ok) {
    const message = body?.message || JSON.stringify(body);
    throw new Error(`NOWPayments invoice creation failed: ${message}`);
  }

  return body; // includes id, invoice_url, etc.
}

/**
 * Recursively sorts object keys — matches NOWPayments' own documented
 * signature algorithm exactly. Do not "improve" or simplify this; the
 * signature will only match if the canonicalization is identical to what
 * NOWPayments used when signing.
 */
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObjectKeys(obj[key]);
      return result;
    }, {});
}

/**
 * Verifies an incoming IPN webhook's signature using the IPN secret
 * (never the API key — they are different credentials).
 *
 * Uses a timing-safe comparison per safeguard #5 — a naive `===` string
 * comparison on a signature is a timing-attack surface.
 */
export function verifyIpnSignature(parsedBody, signatureHeader) {
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!ipnSecret) {
    throw new Error('NOWPAYMENTS_IPN_SECRET is not set.');
  }
  if (!signatureHeader) {
    return false;
  }

  const sorted = sortObjectKeys(parsedBody);
  const sortedJson = JSON.stringify(sorted);

  const expectedSignature = crypto
    .createHmac('sha512', ipnSecret)
    .update(sortedJson)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(signatureHeader, 'hex');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * NOWPayments' real IPN status vocabulary (confirmed against current docs
 * — do not extend this list speculatively; "wrong_asset" etc. are
 * dashboard-only labels, not values this function will ever receive).
 */
export const KNOWN_PAYMENT_STATUSES = new Set([
  'waiting',
  'confirming',
  'confirmed',
  'sending',
  'finished',
  'partially_paid',
  'expired',
  'failed',
  'refunded'
]);
