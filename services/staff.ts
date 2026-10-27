import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import type { StaffOption } from "@/lib/types/views";
import type { Role } from "@/lib/types";

/**
 * Staff lookups for assignment pickers. Reads go through the Admin SDK, so the
 * caller is responsible for deciding which roles may be listed.
 */
export async function listStaffOptions(
  roles?: Role[],
  options: { propertyId?: string; includeInactive?: boolean } = {},
): Promise<StaffOption[]> {
  const snapshot = await adminDb()
    .collection("users")
    .orderBy("fullName")
    .limit(200)
    .get();

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        fullName: (data.fullName as string) ?? "",
        role: data.role as Role,
        propertyIds: (data.propertyIds as string[]) ?? [],
        active: data.active === true,
      } satisfies StaffOption;
    })
    .filter((person) => {
      if (!options.includeInactive && !person.active) return false;
      if (roles && !roles.includes(person.role)) return false;
      if (options.propertyId) {
        // Admins are global; everyone else must be scoped to the property.
        if (person.role === "admin") return true;
        if (!person.propertyIds.includes(options.propertyId)) return false;
      }
      return true;
    });
}

export async function getStaffNames(uids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(uids.filter(Boolean))];
  if (unique.length === 0) return {};

  const db = adminDb();
  const names: Record<string, string> = {};

  for (let index = 0; index < unique.length; index += 30) {
    const chunk = unique.slice(index, index + 30);
    const snapshot = await db
      .collection("users")
      .where(FieldPath.documentId(), "in", chunk)
      .get();
    snapshot.docs.forEach((doc) => {
      names[doc.id] = (doc.data().fullName as string) ?? doc.id;
    });
  }

  return names;
}
