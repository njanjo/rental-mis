"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "demo-rental-mis.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-rental-mis",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "demo-rental-mis.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:000000000000:web:0000000000000000000000",
};

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";
const emulatorHost = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";

interface FirebaseGlobals {
  app?: FirebaseApp;
  auth?: Auth;
  db?: Firestore;
  emulatorsConnected?: boolean;
}

// Reuse across HMR reloads so we never call initializeApp twice.
const globalForFirebase = globalThis as typeof globalThis & {
  __rentalMisFirebase?: FirebaseGlobals;
};

function registry(): FirebaseGlobals {
  globalForFirebase.__rentalMisFirebase ??= {};
  return globalForFirebase.__rentalMisFirebase;
}

export function getFirebaseApp(): FirebaseApp {
  const store = registry();
  if (!store.app) {
    store.app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  }
  return store.app;
}

export function getFirebaseAuth(): Auth {
  const store = registry();
  if (!store.auth) {
    store.auth = getAuth(getFirebaseApp());
    if (useEmulators && !store.emulatorsConnected) {
      connectAuthEmulator(store.auth, `http://${emulatorHost}:9099`, {
        disableWarnings: true,
      });
    }
  }
  return store.auth;
}

export function getFirebaseDb(): Firestore {
  const store = registry();
  if (!store.db) {
    store.db = getFirestore(getFirebaseApp());
    if (useEmulators && !store.emulatorsConnected) {
      connectFirestoreEmulator(store.db, emulatorHost, 8080);
    }
  }
  if (useEmulators) {
    store.emulatorsConnected = true;
  }
  return store.db;
}

export const isUsingEmulators = useEmulators;
