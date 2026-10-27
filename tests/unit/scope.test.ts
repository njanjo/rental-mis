import { describe, expect, it } from "vitest";

import {
  chunkIn,
  hasGlobalScope,
  scopePropertyIds,
  assertPropertyAccess,
} from "@/lib/auth/scope";
import { ServiceError } from "@/lib/errors";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/types";

function user(role: Role, propertyIds: string[] = []): SessionUser {
  return {
    uid: `uid_${role}`,
    email: `${role}@rentalmis.test`,
    fullName: role,
    role,
    active: true,
    propertyIds,
  };
}

describe("property scope", () => {
  it("gives admins and auditors global scope", () => {
    expect(hasGlobalScope(user("admin"))).toBe(true);
    expect(hasGlobalScope(user("auditor"))).toBe(true);
    expect(hasGlobalScope(user("property_manager", ["p1"]))).toBe(false);
  });

  it("returns null for global roles and ids for scoped roles", () => {
    expect(scopePropertyIds(user("admin"))).toBeNull();
    expect(scopePropertyIds(user("property_manager", ["p1", "p1", "p2"]))).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("refuses to build an empty scope", () => {
    expect(() => scopePropertyIds(user("finance"))).toThrow(ServiceError);
  });

  it("allows scoped access only to assigned properties", () => {
    const manager = user("property_manager", ["p1"]);
    expect(() => assertPropertyAccess(manager, "p1")).not.toThrow();
    expect(() => assertPropertyAccess(manager, "p2")).toThrow(ServiceError);
    expect(() => assertPropertyAccess(user("admin"), "p2")).not.toThrow();
  });
});

describe("chunkIn", () => {
  it("splits values into Firestore-safe chunks", () => {
    const values = Array.from({ length: 65 }, (_, index) => `p${index}`);
    const chunks = chunkIn(values);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(30);
    expect(chunks[2]).toHaveLength(5);
  });

  it("rejects sizes above the Firestore limit", () => {
    expect(() => chunkIn([1], 31)).toThrow();
  });
});
