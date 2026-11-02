import "server-only";

import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Admin SDK — trusted backend only. Never import this from a client component
 * or from `middleware.ts` (Edge runtime).
 *
 * Credentials come from FIREBASE_SERVICE_ACCOUNT (the whole service-account
 * file as one env var — the Netlify/Actions form) or, for local dev,
 * FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.
 * When both are absent (emulator, or Google-hosted runtimes) Application
 * Default Credentials are used.
 */
function buildApp(): App {
  if (getApps().length > 0) {
    return getApp();
  }

  // Preferred form: the whole service-account file, pasted verbatim into a
  // single environment variable. JSON strings already escape newline-affected
  // characters, so this survives any hosting UI without shell escaping.
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccountJson) {
    let parsed: { project_id?: string; client_email?: string; private_key?: string };
    try {
      parsed = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error(
        "FIREBASE_SERVICE_ACCOUNT is not valid JSON — paste the entire service-account file as-is.",
      );
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key fields.");
    }
    const projectId = parsed.project_id ?? process.env.FIREBASE_PROJECT_ID;
    if (!projectId) {
      throw new Error("FIREBASE_PROJECT_ID is not set.");
    }
    return initializeApp({
      credential: cert({ projectId, clientEmail: parsed.client_email, privateKey: parsed.private_key }),
      projectId,
    });
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }

  // Emulator: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST route the
  // SDK automatically. Cloud runtimes fall back to Application Default Creds.
  return initializeApp(projectId ? { projectId } : undefined);
}

export function adminApp(): App {
  return buildApp();
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

export function adminDb(): Firestore {
  return getFirestore(adminApp());
}
