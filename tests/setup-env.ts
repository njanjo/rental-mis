/**
 * Test environment defaults.
 *
 * `npm test` runs inside `firebase emulators:exec`, which injects
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST and GCLOUD_PROJECT.
 * These fallbacks keep a bare `vitest run` pointed at the same local emulator
 * instead of a real project.
 */
process.env.FIREBASE_PROJECT_ID ??=
  process.env.GCLOUD_PROJECT ?? "demo-rental-mis";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
