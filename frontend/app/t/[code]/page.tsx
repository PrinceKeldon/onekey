"use client";

import { useEffect, useState } from "react";
import { getThing, checkIdentity, claimThing, addDocument, transferOwnership, mediaUrl } from "../../../lib/api";

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

  function load() {
    return getThing(code).then(setThing);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [code]);

  if (loading) return <Centered>Loading…</Centered>;
  if (thing) return <KnownThing thing={thing} code={code} onUpdated={load} />;
  return <UnclaimedThing code={code} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 480, margin: "0 auto", padding: "3rem 1.5rem" }}>{children}</main>;
}

function KnownThing({ thing, code, onUpdated }: { thing: Thing; code: string; onUpdated: () => Promise<void> }) {
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
          src={mediaUrl('/things/' + thing.onekey_code + '/photo')}
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

      {thing.documents.length > 0 && (
        <>
          <h3 style={{ marginTop: "1.5rem" }}>Documents</h3>
          <ul style={{ paddingLeft: "1.2rem", opacity: 0.85 }}>
            {thing.documents.map((d, i) => (
              <li key={i}>
                <a href={mediaUrl(d.url)} target="_blank" rel="noreferrer" style={{ color: "#8ab4f8" }}>
                  {d.label}
                </a>{" "}
                · {new Date(d.uploaded_at).toLocaleDateString()}
              </li>
            ))}
          </ul>
        </>
      )}

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "2rem", flexWrap: "wrap" }}>
        <AddDocumentPanel code={code} onUpdated={onUpdated} />
        <TransferOwnershipPanel code={code} onUpdated={onUpdated} />
      </div>
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

function AddDocumentPanel({ code, onUpdated }: { code: string; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [ownerContact, setOwnerContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a file.");
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("label", label);
      form.append("owner_contact", ownerContact);
      form.append("file", file);
      await addDocument(code, form);
      await onUpdated();
      setLabel("");
      setFile(null);
      setOwnerContact("");
      setOpen(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={btnStyle}>
        + Add document
      </button>
    );
  }

  return (
    <form onSubmit={submit} style={panelStyle}>
      <strong>Add document</strong>
      <label>
        Label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Receipt, warranty, repair invoice…"
          required
          style={inputStyle}
        />
      </label>
      <label>
        File
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required style={inputStyle} />
      </label>
      <label>
        Your email or phone (proves you're the owner)
        <input value={ownerContact} onChange={(e) => setOwnerContact(e.target.value)} required style={inputStyle} />
      </label>

      {error && <p style={{ color: "#f28b82", margin: 0 }}>{error}</p>}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={submitting} style={btnStyle}>
          {submitting ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} style={secondaryBtnStyle}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function TransferOwnershipPanel({ code, onUpdated }: { code: string; onUpdated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [currentOwnerContact, setCurrentOwnerContact] = useState("");
  const [newOwnerContact, setNewOwnerContact] = useState("");
  const [newOwnerName, setNewOwnerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("current_owner_contact", currentOwnerContact);
      form.append("new_owner_contact", newOwnerContact);
      form.append("new_owner_display_name", newOwnerName);
      const res = await transferOwnership(code, form);
      await onUpdated();
      setDone(res.new_owner_display_name);
      setCurrentOwnerContact("");
      setNewOwnerContact("");
      setNewOwnerName("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => { setOpen(true); setDone(null); }} style={secondaryBtnStyle}>
        Transfer ownership
      </button>
    );
  }

  if (done) {
    return (
      <div style={panelStyle}>
        <strong>Transferred.</strong>
        <p style={{ opacity: 0.7, margin: 0 }}>Now owned by {done}.</p>
        <button type="button" onClick={() => setOpen(false)} style={secondaryBtnStyle}>
          Close
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={panelStyle}>
      <strong>Transfer ownership</strong>
      <p style={{ opacity: 0.6, fontSize: "0.85rem", margin: 0 }}>
        Both sides required — this can't be undone from here.
      </p>
      <label>
        Your email or phone (current owner)
        <input value={currentOwnerContact} onChange={(e) => setCurrentOwnerContact(e.target.value)} required style={inputStyle} />
      </label>
      <label>
        New owner's name
        <input value={newOwnerName} onChange={(e) => setNewOwnerName(e.target.value)} required style={inputStyle} />
      </label>
      <label>
        New owner's email or phone
        <input value={newOwnerContact} onChange={(e) => setNewOwnerContact(e.target.value)} required style={inputStyle} />
      </label>

      {error && <p style={{ color: "#f28b82", margin: 0 }}>{error}</p>}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={submitting} style={btnStyle}>
          {submitting ? "Transferring…" : "Transfer"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} style={secondaryBtnStyle}>
          Cancel
        </button>
      </div>
    </form>
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

const secondaryBtnStyle: React.CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: 8,
  border: "1px solid #2a2a2e",
  background: "transparent",
  color: "#f2f2f2",
  opacity: 0.75,
  cursor: "pointer",
};

const panelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.6rem",
  width: "100%",
  padding: "1rem",
  borderRadius: 10,
  border: "1px solid #2a2a2e",
  background: "#141416",
};
