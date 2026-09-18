"use client";

import { useEffect, useState } from "react";
import { getThing, checkIdentity, claimThing, mediaUrl } from "../../../lib/api";

type Thing = {
  onekey_code: string;
  name: string;
  status: string;
  owner_display_name: string;
  created_at: string;
  identity_type: string;
  identity_value: string;
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
  const identityLabel = thing.identity_type === "qr_tag"
    ? "ONEKEY tag"
    : thing.identity_type === "barcode"
      ? "Barcode"
      : "Serial number";

  return (
    <Centered>
      {primaryPhoto && (
        <img
          src={mediaUrl(primaryPhoto.url)}
          alt={thing.name}
          style={{ width: "100%", borderRadius: 12, marginBottom: "1rem", objectFit: "cover", maxHeight: 320 }}
        />
      )}
      <h1 style={{ marginBottom: 0 }}>{thing.name}</h1>
      <p style={{ opacity: 0.6, marginTop: 4 }}>ONEKEY #{thing.onekey_code}</p>

      <Row label={identityLabel} value={thing.identity_value} />
      <Row label="Owner" value={thing.owner_display_name} />
      <Row label="Status" value={thing.status} />
      <Row label="Documents" value={`${thing.documents.length} document${thing.documents.length === 1 ? "" : "s"}`} />

      <h3 style={{ marginTop: "2rem" }}>History</h3>
      <ul style={{ paddingLeft: "1.2rem", opacity: 0.85 }}>
        {thing.history.map((h, i) => (
          <li key={i}>
            {h.type.replace("_", " ")}
            {h.detail ? ` — ${h.detail}` : ""} · {new Date(h.created_at).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </Centered>
  );
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
    const normalized = identityValue.trim().toUpperCase();
    if (!normalized) return;
    setIdentityValue(normalized);
    const res = await checkIdentity("serial", normalized);
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
        form.append("identity_value", identityValue.trim().toUpperCase());
      } else {
        form.append("identity_type", "qr_tag");
        form.append("tag_code", code);
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
                  onChange={(e) => setIdentityValue(e.target.value.toUpperCase())}
                  onBlur={checkSerial}
                  required
                  style={inputStyle}
                />
              </label>
              <p style={{ opacity: 0.6, fontSize: "0.8rem", margin: 0 }}>
                ONEKEY stores identifiers in uppercase. Enter the characters exactly as printed on the device.
              </p>
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
