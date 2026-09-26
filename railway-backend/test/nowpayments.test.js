import { describe, test, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyIpnSignature, KNOWN_PAYMENT_STATUSES } from '../src/services/nowpayments.js';

const SECRET = 'test-ipn-secret';

function sign(body, secret) {
  function sortKeys(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    return Object.keys(obj).sort().reduce((r, k) => {
      r[k] = sortKeys(obj[k]);
      return r;
    }, {});
  }
  const sorted = sortKeys(body);
  return crypto.createHmac('sha512', secret).update(JSON.stringify(sorted)).digest('hex');
}

describe('verifyIpnSignature', () => {
  const originalEnv = process.env.NOWPAYMENTS_IPN_SECRET;

  test('accepts a correctly signed payload', () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const body = { payment_id: 123, payment_status: 'finished', order_id: 'abc' };
    const sig = sign(body, SECRET);
    expect(verifyIpnSignature(body, sig)).toBe(true);
    process.env.NOWPAYMENTS_IPN_SECRET = originalEnv;
  });

  test('rejects a payload signed with the wrong secret', () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const body = { payment_id: 123, payment_status: 'finished', order_id: 'abc' };
    const sig = sign(body, 'wrong-secret');
    expect(verifyIpnSignature(body, sig)).toBe(false);
    process.env.NOWPAYMENTS_IPN_SECRET = originalEnv;
  });

  test('rejects a tampered payload (amount changed after signing)', () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const body = { payment_id: 123, payment_status: 'finished', order_id: 'abc', price_amount: 100 };
    const sig = sign(body, SECRET);
    const tampered = { ...body, price_amount: 1 };
    expect(verifyIpnSignature(tampered, sig)).toBe(false);
    process.env.NOWPAYMENTS_IPN_SECRET = originalEnv;
  });

  test('rejects a missing signature header', () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const body = { payment_id: 123, payment_status: 'finished' };
    expect(verifyIpnSignature(body, undefined)).toBe(false);
    process.env.NOWPAYMENTS_IPN_SECRET = originalEnv;
  });

  test('is order-independent — key order in the object does not affect the signature', () => {
    process.env.NOWPAYMENTS_IPN_SECRET = SECRET;
    const bodyA = { payment_id: 123, payment_status: 'finished' };
    const bodyB = { payment_status: 'finished', payment_id: 123 };
    const sig = sign(bodyA, SECRET);
    expect(verifyIpnSignature(bodyB, sig)).toBe(true);
    process.env.NOWPAYMENTS_IPN_SECRET = originalEnv;
  });
});

describe('KNOWN_PAYMENT_STATUSES', () => {
  test('contains the real NOWPayments status vocabulary', () => {
    expect(KNOWN_PAYMENT_STATUSES.has('finished')).toBe(true);
    expect(KNOWN_PAYMENT_STATUSES.has('partially_paid')).toBe(true);
    expect(KNOWN_PAYMENT_STATUSES.has('expired')).toBe(true);
  });

  test('does NOT contain invented/dashboard-only labels', () => {
    expect(KNOWN_PAYMENT_STATUSES.has('wrong_asset')).toBe(false);
  });
});
