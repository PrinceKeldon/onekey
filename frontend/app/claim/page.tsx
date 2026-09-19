"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { checkIdentity, claimThing } from "../../lib/api";
import MagicLinkGate from "../../components/MagicLinkGate";

// Entry point for Path A: an object that already has its own serial/barcode
// and has no physical ONEKEY tag yet. The landing-page serial lookup can
// arrive here with the identifier already populated.

const BARCODE_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
];

export default function ClaimBySerial() {
  const [identityType, setIdentityType] = useState<"serial" | "barcode">("serial");
  const [identityValue, setIdentityValue] = useState("");
  const [conflict, setConflict] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryType = params.get("identity_type");
    const queryValue = params.get("identity_value");

    if (queryType === "barcode") setIdentityType("barcode");
    if (queryType === "serial" || queryType === "barcode") {
      setIdentityType(queryType);
    }
    if (queryValue) {
      const normalized = queryValue.trim().toUpperCase();
      setIdentityValue(normalized);
      checkValue(normalized, queryType === "barcode" ? "barcode" : "serial");
    }
  }, []);

  async function checkValue(
    valueOverride?: string,
    typeOverride?: "serial" | "barcode"
  ) {
    const val = (valueOverride ?? identityValue).trim().toUpperCase();
    const type = typeOverride ?? identityType;
    if (!val) return;

    const res = await checkIdentity(type, val);
    setIdentityValue(val);
    setConflict(res.available ? null : res.existing_onekey_code || "another record");
    setChecked(true);
  }

  async function startBarcodeScan() {
    setScanError(null);
    setIdentityType("barcode");
    setChecked(false);
    setConflict(null);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, BARCODE_FORMATS);
    const reader = new BrowserMultiFormatReader(hints);
    readerRef.current = reader;

    try {
      // Attach the stream via decodeFromStream ONLY — not manually first.
      // Attaching the same stream twice (once by hand, once inside
      // decodeFromStream) is a race that can leave the <video> element
      // rendering black with nothing thrown, even though the stream itself
      // is live. Confirmed regression: this exact bug was already fixed
      // once before and came back in a later merge — don't reintroduce it.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      setScanning(true);

      const controls = await reader.decodeFromStream(stream, videoRef.current!, (result, err, ctrl) => {
        if (result) {
          const text = result.getText();
          ctrl.stop();
          stopBarcodeScan();
          const normalized = text.trim().toUpperCase();
          setIdentityValue(normalized);
          checkValue(normalized, "barcode");
          return;
        }
        // ZXing fires NotFoundException continuously while no barcode is in
        // frame — expected noise. Anything else gets surfaced so a black
        // screen has a visible cause instead of failing silently.
        if (err && err.name !== "NotFoundException") {
          setScanError(`Scanner error: ${err.name} — ${err.message || "no detail"}`);
        }
      });
      controlsRef.current = controls;
    } catch (err: any) {
      setScanning(false);
      setScanError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Enter the barcode number manually below."
          : "Couldn't access the camera. Enter the barcode number manually below."
      );
    }
  }

  function stopBarcodeScan() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }

  useEffect(() => stopBarcodeScan, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) return setError("A reference photo is required.");
    if (conflict) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("owner_display_name", ownerName);
      form.append("identity_type", identityType);
      form.append("identity_value", identityValue.trim().toUpperCase());
      form.append("photo", photo);
      const res = await claimThing(form);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!authEmail) return <MagicLinkGate onReady={setAuthEmail} />;

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
      <h1 style={{ marginBottom: 4 }}>Register by serial or barcode</h1>
      <p style={{ opacity: 0.7, marginBottom: "1.5rem" }}>
        For items that already carry their own identifier — no physical ONEKEY tag needed.
      </p>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => { stopBarcodeScan(); setIdentityType("serial"); setChecked(false); setConflict(null); }}
          style={identityType === "serial" ? activeTab : tab}
        >
          Serial number
        </button>
        <button
          onClick={() => { setIdentityType("barcode"); setChecked(false); setConflict(null); }}
          style={identityType === "barcode" ? activeTab : tab}
        >
          Barcode (UPC/EAN)
        </button>
      </div>

      {identityType === "barcode" && !scanning && (
        <button onClick={startBarcodeScan} style={{ ...secondaryBtn, marginBottom: "1rem" }}>
          📷 Scan barcode
        </button>
      )}

      {scanning && (
        <div style={{ marginBottom: "1rem" }}>
          <video ref={videoRef} style={{ width: "100%", borderRadius: 12 }} muted autoPlay playsInline />
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 8 }}>
            Hold the barcode steady in frame…
          </p>
          <button onClick={stopBarcodeScan} style={{ ...secondaryBtn, marginTop: 8 }}>
            Cancel scan
          </button>
        </div>
      )}

      {scanError && <p style={{ color: "#f28b82", marginBottom: "1rem" }}>{scanError}</p>}

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          {identityType === "serial" ? "Serial number" : "Barcode number"}
          <input
            value={identityValue}
            onChange={(e) => { setIdentityValue(e.target.value.toUpperCase()); setChecked(false); }}
            onBlur={() => checkValue()}
            required
            style={inputStyle}
          />
        </label>
        <p style={{ opacity: 0.6, fontSize: "0.8rem", margin: 0 }}>
          ONEKEY stores identifiers in uppercase. Enter the characters exactly as printed on the device.
        </p>

        {checked && conflict && (
          <p style={{ color: "#f28b82" }}>
            Already claimed as ONEKEY #{conflict}.{" "}
            <a href={`/t/${conflict}`} style={{ color: "#8ab4f8" }}>View it</a> instead of creating a duplicate.
          </p>
        )}
        {checked && !conflict && (
          <p style={{ color: "#81c995" }}>Not claimed yet — you're clear to register it.</p>
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
          Reference photo
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} required style={inputStyle} />
        </label>

        {error && <p style={{ color: "#f28b82" }}>{error}</p>}

        <button type="submit" disabled={submitting || !!conflict} style={{ ...primaryBtn, marginTop: "0.5rem" }}>
          {submitting ? "Creating…" : "Create ONEKEY"}
        </button>
      </form>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main style={{ maxWidth: 480, margin: "0 auto", padding: "3rem 1.5rem" }}>{children}</main>;
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4, padding: "0.5rem",
  borderRadius: 6, border: "1px solid #3a3a3e", background: "#1a1a1d", color: "#f2f2f2",
};
const primaryBtn: React.CSSProperties = {
  padding: "0.75rem 1.5rem", borderRadius: 10, border: "none",
  background: "#8ab4f8", color: "#0e0e10", fontWeight: 600, cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "0.6rem 1rem", borderRadius: 8, border: "1px solid #3a3a3e",
  background: "#1a1a1d", color: "#f2f2f2", cursor: "pointer",
};
const tab: React.CSSProperties = {
  padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #3a3a3e",
  background: "#1a1a1d", color: "#f2f2f2", cursor: "pointer", opacity: 0.6,
};
const activeTab: React.CSSProperties = { ...tab, opacity: 1, borderColor: "#8ab4f8" };
