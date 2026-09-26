import { auth, db } from '../firebaseAdmin.js';

/**
 * Verifies a Firebase ID token AND independently checks that the resulting
 * UID has an admin record in Firestore.
 *
 * Safeguard #1 from the frozen contract: "Being signed in is not
 * sufficient." A valid, currently-logged-in Firebase user who is NOT an
 * admin must be rejected here, not just kept out of the admin UI.
 */
export async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired ID token.' });
  }

  const uid = decoded.uid;

  // The admin check hits Firestore directly — never trust a custom claim
  // or client-supplied field claiming admin status without this lookup.
  const adminDoc = await db.collection('admins').doc(uid).get();
  if (!adminDoc.exists) {
    return res.status(403).json({ error: 'Authenticated, but not authorized as admin.' });
  }

  req.adminUid = uid;
  next();
}
