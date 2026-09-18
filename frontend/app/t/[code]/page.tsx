"use client";

import { useEffect, useState } from "react";
import { getThing, checkIdentity, claimThing, mediaUrl, requestTransfer, confirmTransfer } from "../../../lib/api";
import { supabase } from "../../../lib/supabaseClient";

type Thing = {
  onekey_code: string;
  name: string;
  status: string;
  owner_display_name: string;
  created_at: string;
  history: { type: string; detail?: string; created_at: string }[];
  documents: { label: string; url: string; uploaded_at: string }[];
  photos: { url: string; is_primary: boolean; created_at: string }[];
};

export default function ThingPage({ params }: { params: { code: string } }) {
  const { code } = params;
  const [loading, setLoading] = useState(true);
  const [thing, setThing] = useState<Thing | null>(null);

  useEffect(() => {
    getThing(code)
      .then(setThing)
      .finally(() => setLoading(false));
  }, [code]);

  if (loading) return <Centered>Loading…</Centered>;
  if (thing) return <KnownThing thing={thing} />;
  return <UnclaimedThing code={code} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 480, margin: "0 auto", padding: "3rem 1.5rem" }}>{children}</main>;
}

function KnownThing({ thing }: { thing: Thing }) {
  const primaryPhoto = thing.photos.find((p) => p.is_primary) || thing.photos[0];
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const transferId = params.get("transfer");
    const role = params.get("role");
    if (!transferId || (role !== "current" && role !== "new")) return;

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const token = data.session?.access_token;
      if (!token) {
        setConfirmationError("Please open the confirmation link from the email again.");
        return;
      }
      try {
        const result = await confirmTransfer(transferId, role, token);
        if (!active) return;
        if (result.status === "completed") {
          setConfirmationMessage("Ownership transfer confirmed. The ONEKEY record is now updated.");
        } else {
          setConfirmationMessage(
            role === "current"
              ? "Your confirmation is recorded. The new owner still needs to confirm."
              : "Your confirmation is recorded. The current owner still needs to confirm.",
          );
        }
      } catch (err: any) {
        if (active) setConfirmationError(err.message || "Transfer confirmation failed.");
      }
    });

    return () => {
      active = false;
    };
  }, [thing.onekey_code]);

  return (
    <Centered>
      {confirmationMessage && (
        <p style={{ background: "#18351f", padding: "0.8rem", borderRadius: 8 }}>
          {confirmationMessage}
        </p>
      )}
      {confirmationError && (
        <p style={{ background: "#3a2020", padding: "0.8rem", borderRadius: 8, color: "#f2b8b5" }}>
          {confirmationError}
        </p>
      )}

      {primaryPhoto && (
        <img
          src={mediaUrl(primaryPhoto.url, thing.onekey_code)}
          alt={thing.name}
          style={{ width: "100%", borderRadius: 12, marginBottom: "1rem", objectFit: "cover", maxHeight: 320 }}
        />
      )}
      <h1 style={{ marginBottom: 0 }}>{thing.name}</h1>
      <p style={{ opacity: 0.6, marginTop: 4 }}>ONEKEY #{thing.onekey_code}</p>

      <Row label="Owner" value={thing.owner_display_name} />
      <Row
        label={thing.identity_type === "serial" ? "Serial number" : thing.identity_type === "barcode" ? "Barcode" : "QR tag"}
        value={thing.identity_value}
      />
      <Row label="Status" value={thing.status} />
      <Row label="Created" value={formatDateTime(thing.created_at)} />

      <TransferOwnership
        code={thing.onekey_code}
        currentOwnerName={thing.owner_display_name}
        onTransferred={() => window.location.reload()}
      />

      <section style={{ marginTop: "2rem" }}>
        <h3>Documents</h3>
        {thing.documents.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No documents added yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {thing.documents.map((doc, i) => (
              <div key={i} style={{ borderBottom: "1px solid #2a2a2e", paddingBottom: "0.6rem" }}>
                {doc.url ? (
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#8ab4f8", textDecoration: "none" }}
                  >
                    {doc.label} ↗
                  </a>
                ) : (
                  <strong>{doc.label}</strong>
                )}
                {doc.body && <p style={{ margin: "0.3rem 0 0", opacity: 0.8 }}>{doc.body}</p>}
                <div style={{ fontSize: "0.78rem", opacity: 0.55, marginTop: "0.2rem" }}>
                  Added {formatDateTime(doc.uploaded_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <h3 style={{ marginTop: "2rem" }}>History</h3>
      <ul style={{ paddingLeft: "1.2rem", opacity: 0.85 }}>
        {thing.history.map((h, i) => (
          <li key={i} style={{ marginBottom: "0.55rem" }}>
            {h.type.replace(/_/g, " ")}
            {h.detail ? ` — ${h.detail}` : ""} · {formatDateTime(h.created_at)}
          </li>
        ))}
      </ul>
    </Centered>
  );
}

function TransferOwnership({
  code,
  currentOwnerName,
  onTransferred,
}: {
  code: string;
  currentOwnerName: string;
  onTransferred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [currentOwnerContact, setCurrentOwnerContact] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerContact, setNewOwnerContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await requestTransfer(code, {
        current_owner_contact: currentOwnerContact.trim(),
        new_owner_contact: newOwnerContact.trim(),
        new_owner_display_name: newOwnerName.trim(),
      });

      const origin = window.location.origin;
      const currentRedirect = `${origin}/t/${code}?transfer=${encodeURIComponent(result.transfer_id)}&role=current`;
      const newRedirect = `${origin}/t/${code}?transfer=${encodeURIComponent(result.transfer_id)}&role=new`;

      const [currentEmailResult, newEmailResult] = await Promise.all([
        supabase.auth.signInWithOtp({
          email: currentOwnerContact.trim(),
          options: { emailRedirectTo: currentRedirect },
        }),
        supabase.auth.signInWithOtp({
          email: newOwnerContact.trim(),
          options: { emailRedirectTo: newRedirect },
        }),
      ]);

      if (currentEmailResult.error) throw currentEmailResult.error;
      if (newEmailResult.error) throw newEmailResult.error;

      setSent(true);
    } catch (err: any) {
      setError(err.message || "Could not start the transfer.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...secondaryBtn, marginTop: "0.75rem" }}>
        Transfer ownership
      </button>
    );
  }

  if (sent) {
    return (
      <div style={{ marginTop: "1rem", padding: "0.9rem", border: "1px solid #2a2a2e", borderRadius: 10 }}>
        <strong>Transfer request sent.</strong>
        <p style={{ opacity: 0.7, fontSize: "0.9rem", marginBottom: 0 }}>
          A confirmation email has been sent to {currentOwnerContact} and another to {newOwnerContact}.
          Ownership will change only after both people confirm through their email.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.65rem", marginTop: "1rem" }}>
      <p style={{ opacity: 0.65, fontSize: "0.85rem", margin: 0 }}>
        This transfer requires confirmation from both the current owner and the new owner.
      </p>
      <label>
        Current owner's email
        <input
          type="email"
          value={currentOwnerContact}
          onChange={(e) => setCurrentOwnerContact(e.target.value)}
          required
          style={inputStyle}
        />
      </label>
      <label>
        New owner's name
        <input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} required style={inputStyle} />
      </label>
      <label>
        New owner's email
        <input
          type="email"
          value={newOwnerContact}
          onChange={(e) => setNewOwnerContact(e.target.value)}
          required
          style={inputStyle}
        />
      </label>
      {error && <p style={{ color: "#f28b82" }}>{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={submitting} style={btnStyle}>
          {submitting ? "Sending confirmations…" : "Start transfer"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={secondaryBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #2a2a2e", padding: "0.5rem 0" }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function UnclaimedThing({ code }: { code: string }) {
  const [hasSerial, setHasSerial] = useState<boolean | null>(null);
  const [identityValue, setIdentityValue] = useState("");
  const [identityConflict, setIdentityConflict] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerContact, setOwnerContact] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkSerial() {
    if (!identityValue) return;
    const res = await checkIdentity("serial", identityValue);
    setIdentityConflict(res.available ? null : res.existing_onekey_code || "another record");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) return setError("A reference photo is required.");
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("owner_contact", ownerContact);
      form.append("owner_display_name", ownerName);
      form.append("photo", photo);
      if (hasSerial) {
        form.append("identity_type", "serial");
        form.append("identity_value", identityValue);
      } else {
        form.append("identity_type", "qr_tag");
        form.append("tag_code", code); // bind identity to the physical tag that was scanned
      }
      const res = await claimThing(form);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Centered>
        <h1>This thing has a memory now.</h1>
        <p>ONEKEY #{result.onekey_code}</p>
        {result.photo_warning && (
          <p style={{ background: "#3a2a10", padding: "0.75rem", borderRadius: 8 }}>
            Heads up: this photo looks similar to ONEKEY #{result.photo_warning.similar_thing_code}
            (distance {result.photo_warning.distance}). Just make sure this is actually a different item.
          </p>
        )}
        <a href={`/t/${result.onekey_code}`} style={{ color: "#8ab4f8" }}>View the record →</a>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1>This thing has no memory yet.</h1>
      <p style={{ opacity: 0.7 }}>Create its ONEKEY.</p>

      {hasSerial === null && (
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button onClick={() => setHasSerial(true)} style={btnStyle}>It has a serial/barcode</button>
          <button onClick={() => setHasSerial(false)} style={btnStyle}>No serial — use this QR tag</button>
        </div>
      )}

      {hasSerial !== null && (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
          {hasSerial && (
            <>
              <label>
                Serial / barcode
                <input
                  value={identityValue}
                  onChange={(e) => setIdentityValue(e.target.value)}
                  onBlur={checkSerial}
                  required
                  style={inputStyle}
                />
              </label>
              {identityConflict && (
                <p style={{ color: "#f28b82" }}>
                  Already claimed as ONEKEY #{identityConflict}.{" "}
                  <a href={`/t/${identityConflict}`} style={{ color: "#8ab4f8" }}>View it</a> instead of creating a duplicate.
                </p>
              )}
            </>
          )}

          <label>
            Name this thing
            <input value={name} onChange={(e) => setName(e.target.value)} required style={inputStyle} />
          </label>
          <label>
            Your name
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required style={inputStyle} />
          </label>
          <label>
            Email or phone
            <input value={ownerContact} onChange={(e) => setOwnerContact(e.target.value)} required style={inputStyle} />
          </label>
          <label>
            Reference photo
            <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} required style={inputStyle} />
          </label>

          {error && <p style={{ color: "#f28b82" }}>{error}</p>}

          <button type="submit" disabled={submitting || !!identityConflict} style={{ ...btnStyle, marginTop: "0.5rem" }}>
            {submitting ? "Creating…" : "Create ONEKEY"}
          </button>
        </form>
      )}
    </Centered>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "0.5rem",
  borderRadius: 6,
  border: "1px solid #3a3a3e",
  background: "#1a1a1d",
  color: "#f2f2f2",
};

const btnStyle: React.CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: 8,
  border: "1px solid #3a3a3e",
  background: "#1a1a1d",
  color: "#f2f2f2",
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  ...btnStyle,
  background: "transparent",
};
