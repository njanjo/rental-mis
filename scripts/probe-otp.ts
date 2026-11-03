/**
 * Login-flow probe (emulator): password -> idToken -> POST /api/auth/otp/request.
 * Reproduces exactly what the login page does, but prints the raw response so
 * we see whether the middleware redirects or the route answers JSON.
 *
 *   npm run emulators            # terminal 1
 *   npm run dev                  # terminal 2
 *   npx tsx scripts/probe-otp.ts  # terminal 3
 */
import { readFileSync } from "node:fs";

/** Load .env.local the way the dev server does (probe runs outside Next). */
function loadDotEnv(): void {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2];
      }
    }
  } catch {
    // Missing .env.local: fall back to emulator defaults.
  }
}

async function main(): Promise<number> {
  loadDotEnv();

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key";
  const base = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
  const email = process.env.PROBE_EMAIL ?? "admin@rentalmis.test";
  const password = process.env.PROBE_PASSWORD ?? "Password123!";

  const signIn = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!signIn.ok) {
    throw new Error(`Sign-in failed: ${await signIn.text()}`);
  }
  const { idToken } = (await signIn.json()) as { idToken: string };
  console.log("1. password sign-in: OK");

  const request = await fetch(`${base}/api/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  const text = await request.text();
  console.log(`2. POST /api/auth/otp/request -> ${request.status}`);
  console.log(`   content-type: ${request.headers.get("content-type")}`);
  console.log(`   body: ${text.slice(0, 400)}`);

  if (request.status !== 200 || !text.includes("challengeId")) {
    console.error("OTP request path FAILED (middleware redirect or route error).");
    return 1;
  }
  console.log(
    "3. OTP path OK (challenge queued; the inline Beam drain is the route's job — " +
      "without BEAM_SMS_* configured locally the drain logs a warning and the " +
      "outbox row stays queued by design).",
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("Login-flow probe failed:", error);
    process.exit(1);
  });
