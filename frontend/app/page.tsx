"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { checkIdentity } from "../lib/api";

function extractCode(raw: string): string {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const i = parts.indexOf("t");
    return i !== -1 && parts[i + 1] ? parts[i + 1] : parts[parts.length - 1] || raw;
  } catch { return raw.trim(); }
}

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [serial, setSerial] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  async function startScan() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setScanning(true);
      tick();
    } catch (err: any) {
      setCameraError(err?.name === "NotAllowedError" ? "Camera permission was denied." : "The camera could not be accessed.");
    }
  }

  function stopScan() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function tick() {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return; }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const result = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (result?.data) { const code = extractCode(result.data); stopScan(); router.push(`/t/${code}`); return; }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => stopScan, []);

  async function submitSerial(e: React.FormEvent) {
    e.preventDefault();
    const normalized = serial.trim().toUpperCase();
    if (!normalized) return;
    setLookingUp(true); setLookupError(null);
    try {
      const res = await checkIdentity("serial", normalized);
      if (res.available) router.push(`/claim?identity_type=serial&identity_value=${encodeURIComponent(normalized)}`);
      else if (res.existing_onekey_code) router.push(`/t/${res.existing_onekey_code}`);
      else setLookupError("That identity is already claimed, but its record could not be located.");
    } catch { setLookupError("We couldn't check that serial right now. Please try again."); }
    finally { setLookingUp(false); }
  }

  return (
    <main className="hero">
      <div className="onekey-container hero-inner">
        <div className="eyebrow">A MEMORY LAYER FOR PHYSICAL THINGS</div>
        <h1>Give anything<br />a memory.</h1>
        <p>
          ONEKEY creates a persistent digital record for a physical thing —
          its identity, documents, ownership and history, carried with it over time.
        </p>

        <div className="scan-card">
          {!scanning ? (
            <button className="primary-btn" onClick={startScan}>Scan a ONEKEY</button>
          ) : (
            <div>
              <video ref={videoRef} style={{ width:"100%", borderRadius:14, maxHeight:360, objectFit:"cover" }} muted autoPlay playsInline />
              <canvas ref={canvasRef} style={{ display:"none" }} />
              <p className="empty">Point the camera at a ONEKEY QR code.</p>
              <button className="secondary-btn" onClick={stopScan}>Cancel scan</button>
            </div>
          )}
          {cameraError && <p className="alert" style={{marginTop:14}}>{cameraError} Enter the serial instead.</p>}

          <div className="divider">OR FIND BY IDENTITY</div>
          <form onSubmit={submitSerial} style={{display:"grid",gap:10}}>
            <div className="field">
              <label htmlFor="serial">SERIAL / BARCODE</label>
              <input id="serial" className="input" value={serial} onChange={(e)=>setSerial(e.target.value.toUpperCase())} placeholder="Enter the identifier" autoCapitalize="characters" spellCheck={false} />
            </div>
            {lookupError && <p className="alert" style={{margin:0}}>{lookupError}</p>}
            <button className="secondary-btn" type="submit" disabled={lookingUp}>
              {lookingUp ? "Checking…" : "Find or register"}
            </button>
          </form>
        </div>
        <div className="footer-note">SCAN → CLAIM → RECORD → TRANSFER</div>
      </div>
    </main>
  );
}
