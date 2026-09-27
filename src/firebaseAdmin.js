import admin from 'firebase-admin';

/**
 * Initializes the Firebase Admin SDK from a service account JSON stored in
 * an environment variable (Railway's secret config — never a file in Git).
 *
 * The Admin SDK bypasses Firestore Security Rules entirely. That's exactly
 * why every write in this backend must independently enforce authorization
 * and validation in code — the rules protect against the browser, not
 * against bugs in this server.
 */
function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set. Refusing to start — the ' +
      'backend cannot function without Firebase Admin credentials.'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Check that the full ' +
      'service account file was pasted as a single-line string.'
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id
  });
}

export const app = initFirebaseAdmin();
export const db = admin.firestore();
export const auth = admin.auth();
export default admin;
