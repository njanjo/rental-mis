/**
 * Emulator-only seed data.
 *
 *   npm run emulators    # terminal 1
 *   npm run seed         # terminal 2
 *
 * Refuses to run against anything that is not the local emulator.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

import type { Role } from "../lib/types";
import {
  currentPeriodKey,
  dueDateForPeriod,
  recentPeriodKeys,
} from "../lib/billing";

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // Ignore: CI can supply env vars directly.
}

const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-rental-mis";
const isDemoProject = projectId.startsWith("demo-");

if (!process.env.FIRESTORE_EMULATOR_HOST && !isDemoProject) {
  console.error(
    `Refusing to seed project "${projectId}". This script only runs against the emulator.\n` +
      "Set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 or use a demo-* project id.",
  );
  process.exit(1);
}

process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

const PASSWORD = "Password123!";

const staff: Array<{
  uid: string;
  email: string;
  fullName: string;
  role: Role;
  propertyIds: string[];
  active: boolean;
}> = [
  {
    uid: "staff_admin",
    email: "admin@rentalmis.test",
    fullName: "Amina Yusuf",
    role: "admin",
    propertyIds: [],
    active: true,
  },
  {
    uid: "staff_manager",
    email: "manager@rentalmis.test",
    fullName: "Brian Kimani",
    role: "property_manager",
    propertyIds: ["prop_kilimani"],
    active: true,
  },
  {
    uid: "staff_finance",
    email: "finance@rentalmis.test",
    fullName: "Cynthia Achieng",
    role: "finance",
    propertyIds: ["prop_kilimani"],
    active: true,
  },
  {
    uid: "staff_maintenance",
    email: "maintenance@rentalmis.test",
    fullName: "Dennis Mutua",
    role: "maintenance",
    propertyIds: ["prop_kilimani"],
    active: true,
  },
  {
    uid: "staff_auditor",
    email: "auditor@rentalmis.test",
    fullName: "Esther Njoroge",
    role: "auditor",
    propertyIds: [],
    active: true,
  },
];

const COLLECTIONS = [
  "users",
  "properties",
  "units",
  "tenants",
  "tenantPhones",
  "leases",
  "invoices",
  "payments",
  "paymentAllocations",
  "unmatchedPayments",
  "providerEvents",
  "smsOutbox",
  "smsLogs",
  "maintenanceRequests",
  "auditLogs",
  "bankSyncRuns",
  "systemSettings",
];

async function wipe(): Promise<void> {
  for (const name of COLLECTIONS) {
    const snapshot = await db.collection(name).limit(500).get();
    if (snapshot.empty) continue;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function upsertStaff(): Promise<void> {
  for (const person of staff) {
    try {
      await auth.getUser(person.uid);
    } catch {
      await auth.createUser({
        uid: person.uid,
        email: person.email,
        password: PASSWORD,
        displayName: person.fullName,
        emailVerified: true,
      });
    }

    await auth.updateUser(person.uid, {
      password: PASSWORD,
      displayName: person.fullName,
      disabled: !person.active,
    });
    await auth.setCustomUserClaims(person.uid, { role: person.role });

    await db
      .collection("users")
      .doc(person.uid)
      .set(
        {
          uid: person.uid,
          fullName: person.fullName,
          email: person.email,
          role: person.role,
          propertyIds: person.propertyIds,
          active: person.active,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  }
}

async function seedPortfolio(): Promise<void> {
  const now = new Date();
  const periodKey = currentPeriodKey(now);
  const dueDate = Timestamp.fromDate(dueDateForPeriod(periodKey, 5) ?? now);
  const previousPeriodKey = recentPeriodKeys(2, now)[1] ?? periodKey;
  const previousDueDate = Timestamp.fromDate(
    dueDateForPeriod(previousPeriodKey, 5) ?? now,
  );

  await db.collection("properties").doc("prop_kilimani").set({
    name: "Kilimani Heights",
    nameLower: "kilimani heights",
    address: "Wood Avenue, Kilimani",
    county: "Nairobi",
    managerIds: ["staff_manager"],
    notes: "Caretaker on site on weekdays. Water is borehole-backed.",
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Second property deliberately outside the demo manager's scope so property
  // scoping can be exercised without changing the seed.
  await db.collection("properties").doc("prop_nyali").set({
    name: "Nyali Beach Court",
    nameLower: "nyali beach court",
    address: "Off Link Road, Nyali",
    county: "Mombasa",
    managerIds: [],
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const units = [
    {
      id: "unit_a1",
      unitNumber: "A1",
      rent: 4_500_000,
      deposit: 9_000_000,
      status: "occupied",
      leaseId: "lease_wanjiru_a1",
      tenantId: "tnt_wanjiru",
    },
    {
      id: "unit_a2",
      unitNumber: "A2",
      rent: 5_200_000,
      deposit: 10_400_000,
      status: "vacant",
    },
    {
      id: "unit_b1",
      unitNumber: "B1",
      rent: 6_500_000,
      deposit: 13_000_000,
      status: "occupied",
      leaseId: "lease_otieno_b1",
      tenantId: "tnt_otieno",
    },
    {
      id: "unit_n1",
      unitNumber: "N1",
      rent: 5_800_000,
      deposit: 11_600_000,
      status: "vacant",
      propertyId: "prop_nyali",
    },
  ];

  for (const unit of units) {
    await db
      .collection("units")
      .doc(unit.id)
      .set({
        propertyId: unit.propertyId ?? "prop_kilimani",
        unitNumber: unit.unitNumber,
        rentAmountMinor: unit.rent,
        depositAmountMinor: unit.deposit,
        currency: "KES",
        status: unit.status,
        active: true,
        ...(unit.leaseId ? { activeLeaseId: unit.leaseId } : {}),
        ...(unit.tenantId ? { activeTenantId: unit.tenantId } : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
  }

  const tenants: Array<{
    id: string;
    fullName: string;
    phoneE164: string;
    nationalIdLast4: string;
    propertyIds: string[];
    createdBy: string;
    currentLeaseId?: string;
    currentUnitId?: string;
    currentPropertyId?: string;
  }> = [
    {
      id: "tnt_wanjiru",
      fullName: "Grace Wanjiru",
      phoneE164: "+254712345678",
      nationalIdLast4: "4821",
      propertyIds: ["prop_kilimani"],
      createdBy: "staff_manager",
      currentLeaseId: "lease_wanjiru_a1",
      currentUnitId: "unit_a1",
      currentPropertyId: "prop_kilimani",
    },
    {
      id: "tnt_otieno",
      fullName: "Peter Otieno",
      phoneE164: "+254723456789",
      nationalIdLast4: "9034",
      propertyIds: ["prop_kilimani"],
      createdBy: "staff_manager",
      currentLeaseId: "lease_otieno_b1",
      currentUnitId: "unit_b1",
      currentPropertyId: "prop_kilimani",
    },
    {
      // Deliberately outside the demo manager's scope.
      id: "tnt_amina",
      fullName: "Amina Hassan",
      phoneE164: "+254734567890",
      nationalIdLast4: "5566",
      propertyIds: ["prop_nyali"],
      createdBy: "staff_admin",
    },
  ];

  for (const tenant of tenants) {
    await db
      .collection("tenants")
      .doc(tenant.id)
      .set({
        fullName: tenant.fullName,
        fullNameLower: tenant.fullName.toLowerCase(),
        phoneE164: tenant.phoneE164,
        nationalIdLast4: tenant.nationalIdLast4,
        status: "active",
        consentSms: true,
        propertyIds: tenant.propertyIds,
        createdBy: tenant.createdBy,
        ...(tenant.currentLeaseId
          ? {
              currentLeaseId: tenant.currentLeaseId,
              currentUnitId: tenant.currentUnitId,
              currentPropertyId: tenant.currentPropertyId,
            }
          : {}),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

    // Unique-active-phone index used by payment matching.
    await db.collection("tenantPhones").doc(tenant.phoneE164).set({
      tenantId: tenant.id,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  await db.collection("leases").doc("lease_wanjiru_a1").set({
    tenantId: "tnt_wanjiru",
    unitId: "unit_a1",
    propertyId: "prop_kilimani",
    startDate: Timestamp.fromDate(new Date(now.getFullYear(), 0, 1)),
    endDate: Timestamp.fromDate(new Date(now.getFullYear() + 1, 0, 1)),
    rentAmountMinor: 4_500_000,
    currency: "KES",
    dueDay: 5,
    depositAmountMinor: 9_000_000,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("leases").doc("lease_otieno_b1").set({
    tenantId: "tnt_otieno",
    unitId: "unit_b1",
    propertyId: "prop_kilimani",
    startDate: Timestamp.fromDate(new Date(now.getFullYear(), 2, 1)),
    endDate: Timestamp.fromDate(new Date(now.getFullYear() + 1, 2, 1)),
    rentAmountMinor: 6_500_000,
    currency: "KES",
    dueDay: 5,
    depositAmountMinor: 13_000_000,
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("invoices").doc(`lease_wanjiru_a1_${periodKey}`).set({
    leaseId: "lease_wanjiru_a1",
    tenantId: "tnt_wanjiru",
    unitId: "unit_a1",
    propertyId: "prop_kilimani",
    periodKey,
    dueDate,
    amountDueMinor: 4_500_000,
    amountPaidMinor: 0,
    balanceMinor: 4_500_000,
    currency: "KES",
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("invoices").doc(`lease_otieno_b1_${periodKey}`).set({
    leaseId: "lease_otieno_b1",
    tenantId: "tnt_otieno",
    unitId: "unit_b1",
    propertyId: "prop_kilimani",
    periodKey,
    dueDate,
    amountDueMinor: 6_500_000,
    amountPaidMinor: 0,
    balanceMinor: 6_500_000,
    currency: "KES",
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Previous month left unpaid: exercises the derived overdue state without
  // needing a payment run.
  await db
    .collection("invoices")
    .doc(`lease_wanjiru_a1_${previousPeriodKey}`)
    .set({
      leaseId: "lease_wanjiru_a1",
      tenantId: "tnt_wanjiru",
      unitId: "unit_a1",
      propertyId: "prop_kilimani",
      periodKey: previousPeriodKey,
      dueDate: previousDueDate,
      amountDueMinor: 4_500_000,
      amountPaidMinor: 0,
      balanceMinor: 4_500_000,
      currency: "KES",
      status: "open",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  await db.collection("maintenanceRequests").doc("mr_leak_a1").set({
    propertyId: "prop_kilimani",
    unitId: "unit_a1",
    title: "Leaking kitchen sink",
    issue: "Kitchen sink leaking under the cabinet",
    priority: "high",
    status: "open",
    createdBy: "staff_manager",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Deliberately outside the maintenance demo user's scope.
  await db.collection("maintenanceRequests").doc("mr_paint_n1").set({
    propertyId: "prop_nyali",
    unitId: "unit_n1",
    title: "Corridor paint peeling",
    issue: "Paint is peeling near the lift on the ground floor corridor",
    priority: "medium",
    status: "open",
    createdBy: "staff_admin",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function seedSettings(): Promise<void> {
  await db.collection("systemSettings").doc("billing").set({
    timezone: "Africa/Nairobi",
    currency: "KES",
    billing: {
      allocationStrategy: "oldest_first",
      overpayment: "tenant_credit",
      lateFeeEnabled: false,
      gracePeriodDays: 5,
      invoiceGenerationDay: 1,
    },
    updatedBy: "staff_admin",
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("systemSettings").doc("reminders").set({
    timezone: "Africa/Nairobi",
    currency: "KES",
    reminders: {
      dueSoonDaysBefore: 3,
      overdueRepeatDays: 7,
      maxAttempts: 5,
    },
    updatedBy: "staff_admin",
    updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection("systemSettings").doc("sms").set({
    timezone: "Africa/Nairobi",
    currency: "KES",
    templates: [
      {
        key: "payment_receipt",
        enabled: true,
        body: "Rental MIS: received KES {{amount}} for {{unit}}. Ref {{reference}}. Thank you.",
      },
      {
        key: "rent_due_reminder",
        enabled: true,
        body: "Rental MIS: rent of KES {{amount}} for {{unit}} is due on {{dueDate}}.",
      },
      {
        key: "arrears_notice",
        enabled: true,
        body: "Rental MIS: balance of KES {{balance}} for {{unit}} is overdue. Please settle.",
      },
      {
        key: "lease_expiry",
        enabled: true,
        body: "Rental MIS: your lease for {{unit}} expires on {{endDate}}. Contact the office to renew.",
      },
      {
        key: "bulk_announcement",
        enabled: false,
        body: "{{message}}",
      },
    ],
    updatedBy: "staff_admin",
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function main() {
  console.log(`Seeding project "${projectId}" against the local emulator…`);
  await wipe();
  await upsertStaff();
  await seedPortfolio();
  await seedSettings();

  console.log("\nSeed complete.\n");
  console.table(
    staff.map((person) => ({
      role: person.role,
      email: person.email,
      password: PASSWORD,
      scope: person.propertyIds.length ? person.propertyIds.join(",") : "all properties",
    })),
  );
  console.log("\nOpen the emulator UI: http://127.0.0.1:4000");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
