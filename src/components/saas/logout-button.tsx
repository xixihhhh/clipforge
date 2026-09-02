"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError("Sign out failed. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Sign out failed. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
      <Button type="button" variant="outline" size="sm" onClick={logout} disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
