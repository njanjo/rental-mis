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
 * Credentials come from FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY.
 * When those are absent (emulator, or Google-hosted runtimes) Application
 * Default Credentials are used.
 */
function buildApp(): App {
  if (getApps().length > 0) {
    return getApp();
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
