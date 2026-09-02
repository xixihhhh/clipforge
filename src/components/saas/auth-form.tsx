"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "login" | "register" | "forgot";

const copy = {
  login: { title: "Welcome back", subtitle: "Sign in to your ClipForge workspace", endpoint: "/api/auth/login", button: "Sign in" },
  register: { title: "Create your account", subtitle: "Start building videos in your own workspace", endpoint: "/api/auth/register", button: "Create account" },
  forgot: { title: "Reset your password", subtitle: "We will email you a secure reset link", endpoint: "/api/auth/forgot-password", button: "Send reset link" },
} satisfies Record<AuthMode, { title: string; subtitle: string; endpoint: string; button: string }>;

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const text = copy[mode];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch(text.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const result = await response.json().catch(() => ({}));
    setPending(false);
    if (!response.ok) {
      setError(typeof result.error === "string" ? result.error : "Something went wrong.");
      return;
    }
    if (mode === "forgot") {
      setMessage("If an account exists for that email, a reset link has been sent.");
      return;
    }
    if (mode === "register" && result.needsEmailConfirmation) {
      setMessage("Check your inbox to confirm your email, then sign in.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 shadow-2xl shadow-black/20">
        <Link href="/" className="mb-8 flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-8 w-8 place-items-center rounded-lg brand-gradient text-white">C</span>
          ClipForge
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{text.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{text.subtitle}</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          {mode === "register" && (
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input id="displayName" name="displayName" autoComplete="name" required />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          {mode !== "forgot" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "login" && <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}
              </div>
              <Input id="password" name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}
          <Button type="submit" className="w-full" disabled={pending}>{pending ? "Please wait…" : text.button}</Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "login" ? <>New to ClipForge? <Link href="/register" className="text-primary hover:underline">Create an account</Link></> :
            mode === "register" ? <>Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link></> :
            <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>}
        </p>
      </div>
    </main>
  );
}
