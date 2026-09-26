import express from 'express';
import { db } from '../firebaseAdmin.js';
import { verifyIpnSignature, KNOWN_PAYMENT_STATUSES } from '../services/nowpayments.js';
import { logAction } from '../utils/logger.js';

export const webhooksRouter = express.Router();

/**
 * POST /api/webhooks/nowpayments
 *
 * Safeguard #5: this endpoint has NO authenticated admin session — it
 * can't, the caller is NOWPayments' server, not a browser. Its entire
 * security model rests on the signature check. Everything here should be
 * treated as untrusted until that check passes.
 *
 * This handler ONLY writes payment facts (`status`, `providerPaymentId`,
 * a review flag on anomalies). It never sets `fulfillmentStatus` — that
 * stays an explicit admin action, per the frozen contract.
 */
webhooksRouter.post('/nowpayments', express.json(), async (req, res) => {
  const signature = req.headers['x-nowpayments-sig'];

  let isValid;
  try {
    isValid = verifyIpnSignature(req.body, signature);
  } catch (err) {
    logAction('webhook.verification_error', { error: err.message });
    return res.status(500).send('Verification error.');
  }

  if (!isValid) {
    logAction('webhook.invalid_signature', {});
    return res.status(401).send('Invalid signature.');
  }

  const { order_id: orderId, payment_id: paymentId, payment_status: status, price_amount: priceAmount } = req.body;

  if (!orderId) {
    logAction('webhook.missing_order_id', { paymentId });
    return res.status(400).send('Missing order_id.');
  }

  const docRef = db.collection('paymentRequests').doc(orderId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    // Don't create a record from an unsolicited webhook — orderId should
    // always correspond to a paymentRequest we created ourselves.
    logAction('webhook.unknown_order_id', { orderId, paymentId });
    return res.status(404).send('Unknown order_id.');
  }

  const existing = snapshot.data();

  // Idempotency (safeguard #4): if we've already recorded this exact
  // provider payment id + status, this is a redelivery — acknowledge and
  // do nothing further, rather than reprocessing.
  if (existing.providerPaymentId === String(paymentId) && existing.status === status) {
    logAction('webhook.duplicate_ignored', { orderId, paymentId, status });
    return res.status(200).send('Already processed.');
  }

  const update = {
    providerPaymentId: String(paymentId),
    updatedAt: new Date()
  };

  if (KNOWN_PAYMENT_STATUSES.has(status)) {
    update.status = status;
  } else {
    // Unknown status string — don't silently invent behavior for it.
    // Flag for manual review instead of guessing.
    update.requiresReview = true;
    logAction('webhook.unrecognized_status', { orderId, paymentId, status });
  }

  // Basic amount-mismatch check — flag for review rather than trusting
  // blindly. This does not block the status update; it just raises a flag
  // for the admin to look at.
  if (typeof priceAmount === 'number' && priceAmount !== existing.amount) {
    update.requiresReview = true;
    logAction('webhook.amount_mismatch', {
      orderId,
      expected: existing.amount,
      received: priceAmount
    });
  }

  await docRef.update(update);

  logAction('webhook.processed', { orderId, paymentId, status });

  return res.status(200).send('OK');
});
