"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const next = params.get("next") || "/";
    if (!code) { setError("This sign-in link is missing its verification code."); return; }
    supabase.auth.exchangeCodeForSession(code).then(({ error: authError }) => {
      if (authError) setError(authError.message);
      else router.replace(next);
    });
  }, [router]);

  return <main className="claim"><div className="eyebrow">ONEKEY ACCESS</div><h1>{error ? "The link could not be used." : "Verifying your access…"}</h1>{error && <p className="alert">{error}</p>}</main>;
}
