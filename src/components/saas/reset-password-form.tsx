"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) return setError(result.error ?? "Unable to update password.");
    router.push("/dashboard");
    router.refresh();
  }
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-7">
        <div><h1 className="text-2xl font-bold">Choose a new password</h1><p className="mt-1 text-sm text-muted-foreground">Use at least 8 characters.</p></div>
        <div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={pending}>{pending ? "Updating…" : "Update password"}</Button>
      </form>
    </main>
  );
}
