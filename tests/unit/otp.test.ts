import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  generateOtp,
  hashOtp,
  isValidOtpFormat,
  otpCooldownUntil,
  otpExpiresAt,
  verifyOtp,
  OTP_LENGTH,
  OTP_EXPIRES_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_REQUEST_COOLDOWN_SECONDS,
} from "@/lib/otp";

describe("OTP constants", () => {
  it("uses a 6-digit code with a 10-minute window", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_EXPIRES_MINUTES).toBe(10);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_REQUEST_COOLDOWN_SECONDS).toBe(60);
  });
});

describe("generateOtp", () => {
  it("returns a zero-padded numeric code of the right length", () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    expect(code.length).toBe(OTP_LENGTH);
  });

  it("is not deterministic across calls", () => {
    const codes = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      codes.add(generateOtp());
    }
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("isValidOtpFormat", () => {
  it("accepts 6 digits", () => {
    expect(isValidOtpFormat("123456")).toBe(true);
    expect(isValidOtpFormat("000000")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isValidOtpFormat("12345")).toBe(false);
    expect(isValidOtpFormat("1234567")).toBe(false);
    expect(isValidOtpFormat("abcdef")).toBe(false);
    expect(isValidOtpFormat("12 34")).toBe(false);
    expect(isValidOtpFormat("")).toBe(false);
  });
});

describe("hashOtp / verifyOtp", () => {
  it("matches the same code", () => {
    const code = "482910";
    expect(verifyOtp(code, hashOtp(code))).toBe(true);
  });

  it("does not match a different code", () => {
    expect(verifyOtp("111111", hashOtp("222222"))).toBe(false);
  });

  it("is constant-time safe against length attacks", () => {
    // A hash of a different length must short-circuit without throwing.
    expect(verifyOtp("123456", "abc")).toBe(false);
  });

  it("equals a raw sha256 of the code", () => {
    expect(hashOtp("654321")).toBe(
      createHash("sha256").update("654321", "utf8").digest("hex"),
    );
  });
});

describe("otpExpiresAt / otpCooldownUntil", () => {
  it("expires OTP_EXPIRES_MINUTES after now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const expires = otpExpiresAt(now);
    expect(expires.getTime()).toBe(now.getTime() + OTP_EXPIRES_MINUTES * 60_000);
  });

  it("starts the cooldown OTP_REQUEST_COOLDOWN_SECONDS after now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const cooldown = otpCooldownUntil(now);
    expect(cooldown.getTime()).toBe(
      now.getTime() + OTP_REQUEST_COOLDOWN_SECONDS * 1000,
    );
  });
});