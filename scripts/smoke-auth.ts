/**
 * Auth smoke test against the emulator.
 *
 * Verifies the exact flow the login form uses:
 *   password sign-in -> ID token -> Admin SDK session cookie -> verify.
 *
 *   firebase emulators:exec --only auth,firestore "npx tsx scripts/seed.ts && npx tsx scripts/smoke-auth.ts"
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // CI supplies env vars directly.
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-rental-mis";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key";
const email = "admin@rentalmis.test";
const password = "Password123!";

async function main() {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  if (!response.ok) {
    throw new Error(`Sign-in failed (${response.status}): ${await response.text()}`);
  }

  const { idToken, localId } = (await response.json()) as {
    idToken: string;
    localId: string;
  };

  const adminAuth = getAuth(initializeApp({ projectId }));

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: 60 * 60 * 24 * 5 * 1000,
  });

  const decoded = await adminAuth.verifySessionCookie(sessionCookie, false);

  if (decoded.uid !== localId) {
    throw new Error(`Session uid mismatch: ${decoded.uid} !== ${localId}`);
  }

  console.log("Session cookie flow OK");
  console.log(`  uid:   ${decoded.uid}`);
  console.log(`  email: ${decoded.email}`);
  console.log(`  cookie length: ${sessionCookie.length} bytes`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Auth smoke test failed:", error);
    process.exit(1);
  });
