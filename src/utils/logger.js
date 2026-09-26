/**
 * Minimal structured logging. Deliberately does NOT accept arbitrary
 * blobs — callers pass a small, explicit metadata object, which keeps
 * secrets and full conversation/payment payloads from ending up in logs
 * by accident (safeguard #6).
 */
export function logAction(action, meta = {}) {
  const safeMeta = { ...meta };

  // Belt-and-braces: strip anything that looks like a secret if a caller
  // ever passes one in by mistake.
  for (const key of Object.keys(safeMeta)) {
    if (/key|secret|token|password/i.test(key)) {
      delete safeMeta[key];
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    action,
    ...safeMeta
  }));
}
