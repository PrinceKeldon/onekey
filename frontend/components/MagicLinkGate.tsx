"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function MagicLinkGate({ onReady }: { onReady: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"checking" | "idle" | "sending" | "sent">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const sessionEmail = data.session?.user?.email?.trim().toLowerCase();
      if (sessionEmail) onReady(sessionEmail);
      else setStatus("idle");
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionEmail = session?.user?.email?.trim().toLowerCase();
      if (sessionEmail) onReady(sessionEmail);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [onReady]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    const normalized = email.trim().toLowerCase();
    if (!normalized) return;
    setSendingState("sending");
    setError(null);
    const next = window.location.pathname + window.location.search;
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
    });
    if (authError) {
      setError(authError.message);
      setSendingState("idle");
      return;
    }
    setSendingState("sent");
  }

  function setSendingState(value: "idle" | "sending" | "sent") {
    setStatus(value);
  }

  if (status === "checking") return <main className="claim"><div className="eyebrow">ONEKEY ACCESS</div><p className="empty">Checking your access…</p></main>;
  if (status === "sent") return (
    <main className="claim">
      <div className="eyebrow">CHECK YOUR EMAIL</div>
      <h1>Your ONEKEY is waiting.</h1>
      <p className="empty">We sent a secure sign-in link to <strong>{email.trim().toLowerCase()}</strong>. Open it to continue.</p>
      <button className="secondary-btn" onClick={() => setStatus("idle")}>Use another email</button>
    </main>
  );
  return (
    <main className="claim">
      <div className="eyebrow">CREATE ITS ONEKEY</div>
      <h1>First, make it yours.</h1>
      <p className="empty">We’ll send a secure magic link. No password required.</p>
      <form className="form-stack" onSubmit={sendLink}>
        <div className="field">
          <label htmlFor="magic-email">YOUR EMAIL</label>
          <input id="magic-email" className="input" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" />
        </div>
        {error && <div className="alert">{error}</div>}
        <button className="primary-btn" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send magic link"}</button>
      </form>
    </main>
  );
}
