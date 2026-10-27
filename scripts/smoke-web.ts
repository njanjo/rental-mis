/**
 * End-to-end web smoke test.
 *
 * Requires the emulators, a seeded database and the Next dev server:
 *
 *   npm run emulators                 # terminal 1 (after: npm run seed)
 *   npm run dev                       # terminal 2
 *   npx tsx scripts/smoke-web.ts      # terminal 3
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
const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3000";

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function signIn(email: string, password = "Password123!"): Promise<string> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  if (!response.ok) throw new Error(`Sign-in failed: ${await response.text()}`);
  const { idToken } = (await response.json()) as { idToken: string };
  return idToken;
}

async function sessionCookie(email: string): Promise<string> {
  const adminAuth = getAuth(initializeApp({ projectId }));
  const idToken = await signIn(email);
  return adminAuth.createSessionCookie(idToken, {
    expiresIn: 60 * 60 * 24 * 5 * 1000,
  });
}

async function main() {
  const cookie = await sessionCookie("admin@rentalmis.test");

  // 1. Signed-out dashboard redirects to /login.
  const anonymous = await fetch(`${baseUrl}/dashboard`, { redirect: "manual" });
  record(
    "anonymous /dashboard redirects",
    anonymous.status === 307 || anonymous.status === 302,
    `status ${anonymous.status} -> ${anonymous.headers.get("location") ?? "n/a"}`,
  );

  // 2. Login page renders.
  const login = await fetch(`${baseUrl}/login`);
  const loginHtml = await login.text();
  record(
    "login page renders",
    login.status === 200 && loginHtml.includes("Staff sign in"),
    `status ${login.status}`,
  );

  // 3. Signed-in dashboard renders the shell.
  const dashboard = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const dashboardHtml = await dashboard.text();
  record(
    "signed-in /dashboard renders",
    dashboard.status === 200 && dashboardHtml.includes("Foundation status"),
    `status ${dashboard.status}`,
  );

  // 4. A forged cookie is rejected.
  const forged = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: "__session=not-a-real-cookie" },
    redirect: "manual",
  });
  record(
    "forged cookie is rejected",
    forged.status === 307 || forged.status === 302,
    `status ${forged.status} -> ${forged.headers.get("location") ?? "n/a"}`,
  );

  // 5. Admin sees the finance navigation.
  record(
    "admin nav includes payments",
    dashboardHtml.includes('href="/payments"'),
    "sidebar link present",
  );

  // 6. Maintenance is redirected away from finance and never sees the ledger.
  const maintenanceCookie = await sessionCookie("maintenance@rentalmis.test");
  const maintenance = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: `__session=${maintenanceCookie}` },
  });
  const maintenanceHtml = await maintenance.text();
  record(
    "maintenance is redirected off dashboard",
    maintenance.status === 200 && maintenanceHtml.includes("Maintenance"),
    `status ${maintenance.status}`,
  );
  record(
    "maintenance nav hides payments",
    !maintenanceHtml.includes('href="/payments"') &&
      !maintenanceHtml.includes('href="/invoices"'),
    "finance links absent from sidebar",
  );

  // 7. An auditor can read finance but cannot write.
  const auditorCookie = await sessionCookie("auditor@rentalmis.test");
  const auditor = await fetch(`${baseUrl}/payments`, {
    headers: { Cookie: `__session=${auditorCookie}` },
  });
  record(
    "auditor can open payments route",
    auditor.status === 200,
    `status ${auditor.status}`,
  );

  // 8. Properties list and detail render for an administrator.
  const properties = await fetch(`${baseUrl}/properties`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const propertiesHtml = await properties.text();
  record(
    "admin sees all properties",
    properties.status === 200 &&
      propertiesHtml.includes("Kilimani Heights") &&
      propertiesHtml.includes("Nyali Beach Court"),
    `status ${properties.status}`,
  );

  const propertyDetail = await fetch(`${baseUrl}/properties/prop_kilimani`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const propertyDetailHtml = await propertyDetail.text();
  record(
    "property detail renders",
    propertyDetail.status === 200 &&
      propertyDetailHtml.includes("Property details") &&
      propertyDetailHtml.includes("Wood Avenue"),
    `status ${propertyDetail.status}`,
  );

  // 9. Property scope is enforced for managers.
  const managerCookie = await sessionCookie("manager@rentalmis.test");
  const managerProperties = await fetch(`${baseUrl}/properties`, {
    headers: { Cookie: `__session=${managerCookie}` },
  });
  const managerPropertiesHtml = await managerProperties.text();
  record(
    "manager only sees assigned properties",
    managerProperties.status === 200 &&
      managerPropertiesHtml.includes("Kilimani Heights") &&
      !managerPropertiesHtml.includes("Nyali Beach Court"),
    `status ${managerProperties.status}`,
  );

  const outOfScope = await fetch(`${baseUrl}/properties/prop_nyali`, {
    headers: { Cookie: `__session=${managerCookie}` },
    redirect: "manual",
  });
  record(
    "manager is blocked from an unassigned property",
    outOfScope.status === 404,
    `status ${outOfScope.status}`,
  );

  // 10. Archived properties leave the default list.
  const archived = await fetch(`${baseUrl}/properties?status=archived`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const archivedHtml = await archived.text();
  record(
    "archived filter is empty on a fresh seed",
    archived.status === 200 && !archivedHtml.includes("Kilimani Heights"),
    `status ${archived.status}`,
  );

  // 11. Units list, detail and scope.
  const units = await fetch(`${baseUrl}/units`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const unitsHtml = await units.text();
  record(
    "admin sees units from every property",
    units.status === 200 &&
      unitsHtml.includes("Grace Wanjiru") &&
      unitsHtml.includes("Nyali Beach Court"),
    `status ${units.status}`,
  );

  const unitDetail = await fetch(`${baseUrl}/units/unit_a1`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const unitDetailHtml = await unitDetail.text();
  record(
    "unit detail renders lease history",
    unitDetail.status === 200 &&
      unitDetailHtml.includes("Lease history") &&
      unitDetailHtml.includes("Grace Wanjiru"),
    `status ${unitDetail.status}`,
  );

  const managerUnits = await fetch(`${baseUrl}/units`, {
    headers: { Cookie: `__session=${managerCookie}` },
  });
  const managerUnitsHtml = await managerUnits.text();
  record(
    "manager only sees units in assigned properties",
    managerUnits.status === 200 &&
      managerUnitsHtml.includes("Kilimani Heights") &&
      !managerUnitsHtml.includes("Nyali Beach Court"),
    `status ${managerUnits.status}`,
  );

  const unitOutOfScope = await fetch(`${baseUrl}/units/unit_n1`, {
    headers: { Cookie: `__session=${managerCookie}` },
    redirect: "manual",
  });
  record(
    "manager is blocked from an unassigned unit",
    unitOutOfScope.status === 404,
    `status ${unitOutOfScope.status}`,
  );

  // 12. Tenants list, detail and scope.
  const tenants = await fetch(`${baseUrl}/tenants`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const tenantsHtml = await tenants.text();
  record(
    "admin sees tenants from every property",
    tenants.status === 200 &&
      tenantsHtml.includes("Grace Wanjiru") &&
      tenantsHtml.includes("Amina Hassan"),
    `status ${tenants.status}`,
  );

  const tenantDetail = await fetch(`${baseUrl}/tenants/tnt_wanjiru`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const tenantDetailHtml = await tenantDetail.text();
  record(
    "tenant detail renders contact and tenancy",
    tenantDetail.status === 200 &&
      tenantDetailHtml.includes("Grace Wanjiru") &&
      tenantDetailHtml.includes("Used for M-Pesa matching"),
    `status ${tenantDetail.status}`,
  );

  const managerTenants = await fetch(`${baseUrl}/tenants`, {
    headers: { Cookie: `__session=${managerCookie}` },
  });
  const managerTenantsHtml = await managerTenants.text();
  record(
    "manager only sees tenants in assigned properties",
    managerTenants.status === 200 &&
      managerTenantsHtml.includes("Grace Wanjiru") &&
      !managerTenantsHtml.includes("Amina Hassan"),
    `status ${managerTenants.status}`,
  );

  const tenantOutOfScope = await fetch(`${baseUrl}/tenants/tnt_amina`, {
    headers: { Cookie: `__session=${managerCookie}` },
    redirect: "manual",
  });
  record(
    "manager is blocked from an unassigned tenant",
    tenantOutOfScope.status === 404,
    `status ${tenantOutOfScope.status}`,
  );

  // 13. Leases list, detail and manager scope.
  const leases = await fetch(`${baseUrl}/leases`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const leasesHtml = await leases.text();
  record(
    "admin sees leases across properties",
    leases.status === 200 &&
      leasesHtml.includes("Grace Wanjiru") &&
      leasesHtml.includes("Peter Otieno") &&
      leasesHtml.includes("Kilimani Heights"),
    `status ${leases.status}`,
  );

  const leaseDetail = await fetch(`${baseUrl}/leases/lease_wanjiru_a1`, {
    headers: { Cookie: `__session=${cookie}` },
  });
  const leaseDetailHtml = await leaseDetail.text();
  record(
    "lease detail renders terms and parties",
    leaseDetail.status === 200 &&
      leaseDetailHtml.includes("Lease terms") &&
      leaseDetailHtml.includes("Grace Wanjiru") &&
      leaseDetailHtml.includes("Rent due day"),
    `status ${leaseDetail.status}`,
  );

  const managerLeases = await fetch(`${baseUrl}/leases`, {
    headers: { Cookie: `__session=${managerCookie}` },
  });
  const managerLeasesHtml = await managerLeases.text();
  record(
    "manager sees leases in assigned properties",
    managerLeases.status === 200 &&
      managerLeasesHtml.includes("Grace Wanjiru") &&
      managerLeasesHtml.includes("Peter Otieno"),
    `status ${managerLeases.status}`,
  );

  const managerLeaseDetail = await fetch(
    `${baseUrl}/leases/lease_otieno_b1`,
    { headers: { Cookie: `__session=${managerCookie}` } },
  );
  record(
    "manager can open an assigned lease",
    managerLeaseDetail.status === 200,
    `status ${managerLeaseDetail.status}`,
  );

  console.table(results);

  if (results.some((entry) => !entry.ok)) {
    throw new Error("One or more smoke checks failed.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Web smoke test failed:", error);
    process.exit(1);
  });
