"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { AlertCircle, Eye, EyeOff, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFirebaseAuth } from "@/lib/firebase/client";

const DEMO_EMAIL = "admin@rentalmis.test";
const DEMO_PASSWORD = "Password123!";

function messageFor(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "Incorrect email or password.";
      case "auth/user-disabled":
        return "This account has been disabled.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a few minutes and try again.";
      case "auth/network-request-failed":
        return "Cannot reach the authentication service. Check your connection.";
      case "auth/invalid-email":
        return "Enter a valid email address.";
      default:
        return "Sign in failed. Please try again.";
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return "Sign in failed. Please try again.";
}

export function LoginForm({
  nextPath,
  showDemoHint,
}: {
  nextPath: string;
  showDemoHint: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(showDemoHint ? DEMO_EMAIL : "");
  const [password, setPassword] = useState(showDemoHint ? DEMO_PASSWORD : "");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const auth = getFirebaseAuth();

    try {
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );

      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        await signOut(auth).catch(() => undefined);
        throw new Error(
          payload?.error ?? "Your account is not authorized for this system.",
        );
      }

      toast.success("Signed in");
      router.replace(nextPath);
      router.refresh();
    } catch (cause) {
      setError(messageFor(cause));
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@company.co.ke"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          disabled={pending}
          className="h-10"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={pending}
            className="h-10 pr-10"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1 size-8 text-muted-foreground hover:bg-transparent"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>

      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            <LogIn className="size-4" />
            Sign in
          </>
        )}
      </Button>

      {showDemoHint ? (
        <div className="rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Emulator credentials</p>
          <p className="mt-1 font-mono text-[11px]">{DEMO_EMAIL}</p>
          <p className="font-mono text-[11px]">{DEMO_PASSWORD}</p>
          <p className="mt-1.5">Run <span className="font-mono">npm run emulators</span> and <span className="font-mono">npm run seed</span> first.</p>
        </div>
      ) : null}
    </form>
  );
}
