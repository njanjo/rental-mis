"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { AlertCircle, Loader2, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getFirebaseAuth } from "@/lib/firebase/client";

const MIN_LENGTH = 10;

function messageFor(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
      case "auth/wrong-password":
        return "Current password is incorrect.";
      case "auth/weak-password":
        return `New password is too weak — use at least 6 characters (this form enforces ${MIN_LENGTH}).`;
      case "auth/requires-recent-login":
        return "Your session is too old to change the password. Sign in again, then retry.";
      case "auth/network-request-failed":
        return "Cannot reach the authentication service. Check your connection.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        break;
    }
  }
  return "Could not update the password. Please try again.";
}

/**
 * Self-service password rotation for provisioned staff accounts. Reuses the
 * email already in the session — the current password doubles as both proof
 * of identity and Firebase's recent-login requirement.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (next.length < MIN_LENGTH) {
      setError(`New password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    if (next === current) {
      setError("The new password must be different from the current one.");
      return;
    }

    setPending(true);
    const auth = getFirebaseAuth();
    const user = auth.currentUser;

    try {
      if (!user || !user.email) throw new Error("No signed-in account.");

      // updatePassword requires recent login; the current password satisfies it.
      const credential = EmailAuthProvider.credential(user.email, current);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, next);

      toast.success("Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (cause) {
      if (cause instanceof FirebaseError && cause.code === "auth/requires-recent-login") {
        // Stale session: force a fresh sign-in and bounce back here.
        router.replace("/login?next=/account");
        router.refresh();
      }
      setError(messageFor(cause));
    }
    setPending(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {[
        { id: "current", label: "Current password", value: current, onChange: setCurrent, autoComplete: "current-password", required: true },
        { id: "new", label: `New password (min ${MIN_LENGTH} characters)`, value: next, onChange: setNext, autoComplete: "new-password", required: true },
        { id: "confirm", label: "Confirm new password", value: confirm, onChange: setConfirm, autoComplete: "new-password", required: true },
      ].map((field) => (
        <div className="space-y-2" key={field.id}>
          <Label htmlFor={field.id}>{field.label}</Label>
          <div className="relative">
            <Input
              id={field.id}
              name={field.id}
              type={showPassword ? "text" : "password"}
              autoComplete={field.autoComplete}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              required
              disabled={pending}
              className="h-10 pr-10"
            />
            {field.id === "new" ? (
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
            ) : null}
          </div>
        </div>
      ))}

      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Updating…
          </>
        ) : (
          <>
            <KeyRound className="size-4" />
            Update password
          </>
        )}
      </Button>
    </form>
  );
}
