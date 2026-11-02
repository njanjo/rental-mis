"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const OTP_LENGTH = 6;

function OtpFormInput({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  error?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  return (
    <div className="space-y-2">
      <Label htmlFor="otp">Verification code</Label>
      <Input
        id="otp"
        ref={inputRef}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        maxLength={OTP_LENGTH}
        value={value}
        disabled={disabled}
        className="h-10 text-center text-lg tracking-widest font-mono"
        onChange={(event) => {
          const cleaned = event.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH);
          onChange(cleaned);
        }}
      />
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

export function OtpForm({
  challengeId,
  phoneE164,
  nextPath,
  onResend,
  onCancel,
}: {
  challengeId: string;
  phoneE164: string;
  nextPath: string;
  onResend: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendPending, setResendPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== OTP_LENGTH) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Incorrect code. Try again.");
      }

      window.location.replace(nextPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed.");
      setPending(false);
    }
  }

  async function handleResend() {
    setResendPending(true);
    setError(null);
    try {
      await onResend();
    } catch {
      setError("Could not resend the code. Try again in a moment.");
    } finally {
      setResendPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground dark:bg-emerald-500/10">
        <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
        <span>
          A 6-digit code was sent to{" "}
          <span className="font-mono text-foreground">{phoneE164}</span>.
        </span>
      </div>

      <OtpFormInput
        value={code}
        onChange={setCode}
        disabled={pending}
        error={error}
      />

      <div className="flex items-center gap-2">
        <Button type="submit" className="h-10 flex-1" disabled={pending || code.length !== OTP_LENGTH}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Verifying…
            </>
          ) : (
            "Verify code"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 flex-1"
          disabled={pending || resendPending}
          onClick={handleResend}
        >
          {resendPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Resending…
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Resend
            </>
          )}
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="h-9 w-full text-xs text-muted-foreground"
        disabled={pending}
        onClick={onCancel}
      >
        Use a different account
      </Button>
    </form>
  );
}