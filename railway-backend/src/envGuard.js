// Michael currently has ONE Firebase project (created directly as
// production — no separate test project yet). Both env values point at
// the same real project for now. If a genuine test project is created
// later, split these back into two different IDs.
const EXPECTED_PROJECT_IDS = {
  test: 'my-portfolio-84da2',
  production: 'my-portfolio-84da2'
};

/**
 * Refuses to start if APP_ENV doesn't match the Firebase project this
 * server is actually authenticated against. This is the cheap, boring
 * check that prevents "test deploy accidentally pointed at production"
 * or the reverse.
 */
export function assertCorrectEnvironment(serviceAccountProjectId) {
  const appEnv = process.env.APP_ENV;

  if (!appEnv || !EXPECTED_PROJECT_IDS[appEnv]) {
    throw new Error(
      `APP_ENV is missing or invalid ("${appEnv}"). Must be "test" or ` +
      `"production". Refusing to start.`
    );
  }

  const expected = EXPECTED_PROJECT_IDS[appEnv];
  if (serviceAccountProjectId !== expected) {
    throw new Error(
      `Environment mismatch: APP_ENV="${appEnv}" expects Firebase project ` +
      `"${expected}", but the loaded service account belongs to ` +
      `"${serviceAccountProjectId}". Refusing to start.`
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[env-guard] Verified: APP_ENV="${appEnv}" matches project "${serviceAccountProjectId}".`);
}
