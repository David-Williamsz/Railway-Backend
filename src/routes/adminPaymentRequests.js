import express from 'express';
import { db } from '../firebaseAdmin.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { createInvoice } from '../services/nowpayments.js';
import { logAction } from '../utils/logger.js';

export const adminPaymentRequestsRouter = express.Router();

const ALLOWED_CURRENCIES = new Set(['usd']); // extend deliberately, not by accident

/**
 * POST /api/admin/payment-requests
 * Creates a Firestore paymentRequests doc, then a matching NOWPayments
 * invoice using that doc's ID as order_id — so the webhook can update the
 * exact same document without a search-by-field.
 */
adminPaymentRequestsRouter.post('/', requireAdmin, async (req, res) => {
  const { clientName, description, amount, currency } = req.body ?? {};

  // Safeguard #2: validate every field explicitly. Don't trust shape or
  // types from the client.
  if (typeof clientName !== 'string' || clientName.trim().length === 0) {
    return res.status(400).json({ error: 'clientName is required.' });
  }
  if (typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json({ error: 'description is required.' });
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number.' });
  }
  if (typeof currency !== 'string' || !ALLOWED_CURRENCIES.has(currency.toLowerCase())) {
    return res.status(400).json({ error: `currency must be one of: ${[...ALLOWED_CURRENCIES].join(', ')}` });
  }

  const docRef = db.collection('paymentRequests').doc();
  const now = new Date();

  try {
    // Create the Firestore record first (status: "waiting" as a placeholder)
    // so its ID exists to pass as order_id to NOWPayments.
    await docRef.set({
      clientName: clientName.trim(),
      description: description.trim(),
      amount,
      currency: currency.toLowerCase(),
      provider: 'nowpayments',
      providerPaymentId: null,
      invoiceUrl: null,
      orderId: docRef.id,
      status: 'waiting',
      requiresReview: false,
      fulfillmentStatus: 'unfulfilled',
      createdAt: now,
      updatedAt: now
    });

    const ipnCallbackUrl = `${process.env.PUBLIC_BASE_URL}/api/webhooks/nowpayments`;

    const invoice = await createInvoice({
      orderId: docRef.id,
      amount,
      currency: currency.toLowerCase(),
      description: description.trim(),
      ipnCallbackUrl
    });

    await docRef.update({
      providerPaymentId: String(invoice.id),
      invoiceUrl: invoice.invoice_url,
      updatedAt: new Date()
    });

    logAction('payment_request.created', { adminUid: req.adminUid, paymentRequestId: docRef.id });

    return res.status(201).json({
      id: docRef.id,
      invoiceUrl: invoice.invoice_url
    });
  } catch (err) {
    logAction('payment_request.create_failed', { adminUid: req.adminUid, error: err.message });
    return res.status(502).json({ error: 'Failed to create payment request.' });
  }
});

/**
 * POST /api/admin/payment-requests/:id/fulfill
 *
 * Safeguard #3: this endpoint owns the fulfillment transition and ONLY
 * the fulfillment transition. It never touches `status` (that field is
 * provider-derived, from the webhook, only).
 */
adminPaymentRequestsRouter.post('/:id/fulfill', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const docRef = db.collection('paymentRequests').doc(id);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return res.status(404).json({ error: 'Payment request not found.' });
  }

  const data = snapshot.data();

  if (data.fulfillmentStatus === 'fulfilled') {
    return res.status(200).json({ id, fulfillmentStatus: 'fulfilled', note: 'Already fulfilled.' });
  }

  // Deliberate business rule: don't allow marking fulfilled on a payment
  // that hasn't actually reached a completed provider state. Adjust this
  // list only with an explicit decision, not silently.
  const fulfillableStatuses = new Set(['finished']);
  if (!fulfillableStatuses.has(data.status)) {
    return res.status(409).json({
      error: `Cannot mark fulfilled — payment status is "${data.status}", not a completed state.`
    });
  }

  await docRef.update({
    fulfillmentStatus: 'fulfilled',
    updatedAt: new Date()
  });

  logAction('payment_request.fulfilled', { adminUid: req.adminUid, paymentRequestId: id });

  return res.status(200).json({ id, fulfillmentStatus: 'fulfilled' });
});
