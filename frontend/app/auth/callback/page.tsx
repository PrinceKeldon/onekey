"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next") || "/";
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message);
      else if (data.session?.user?.email) router.replace(next);
      else setError("This sign-in link could not create a session. Please request a new one.");
    });
  }, [router]);

  return <main className="claim"><div className="eyebrow">ONEKEY ACCESS</div><h1>{error ? "The link could not be used." : "Verifying your access…"}</h1>{error && <p className="alert">{error}</p>}</main>;
}
