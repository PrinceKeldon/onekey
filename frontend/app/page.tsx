"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";

// Pulls a ONEKEY code out of whatever a QR actually encodes — either a full
// URL (https://onekey.app/t/8F42K) or just the bare code, depending on how
// the label was printed.
function extractCode(raw: string): string {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const tIndex = parts.indexOf("t");
    if (tIndex !== -1 && parts[tIndex + 1]) return parts[tIndex + 1];
    return parts[parts.length - 1] || raw;
  } catch {
    return raw.trim();
  }
}

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");

  async function startScan() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      tick();
    } catch (err: any) {
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. You can still enter a code manually below."
          : "Couldn't access the camera. You can still enter a code manually below."
      );
    }
  }

  function stopScan() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function tick() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);

    if (result?.data) {
      const code = extractCode(result.data);
      stopScan();
      router.push(`/t/${code}`);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => stopScan, []); // cleanup camera on unmount

  function submitManualCode(e: React.FormEvent) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    router.push(`/t/${manualCode.trim().toUpperCase()}`);
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "3rem 1.5rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "0.25rem" }}>ONEKEY</h1>
      <p style={{ opacity: 0.7, marginBottom: "2rem" }}>Give anything a persistent digital memory.</p>

      {!scanning && (
        <button onClick={startScan} style={primaryBtn}>
          Scan a ONEKEY
        </button>
      )}

      {scanning && (
        <div style={{ position: "relative", marginTop: "1rem" }}>
          <video ref={videoRef} style={{ width: "100%", borderRadius: 12 }} muted playsInline />
          <canvas ref={canvasRef} style={{ display: "none" }} />
          <p style={{ opacity: 0.6, fontSize: "0.85rem", marginTop: 8 }}>Point your camera at the ONEKEY QR code…</p>
          <button onClick={stopScan} style={{ ...secondaryBtn, marginTop: 8 }}>
            Cancel
          </button>
        </div>
      )}

      {cameraError && <p style={{ color: "#f28b82", marginTop: "1rem" }}>{cameraError}</p>}

      <div style={{ marginTop: "2.5rem", opacity: 0.6, fontSize: "0.85rem" }}>— or —</div>

      <form onSubmit={submitManualCode} style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
        <input
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          placeholder="Enter code, e.g. 8F42K"
          style={inputStyle}
        />
        <button type="submit" style={secondaryBtn}>
          Go
        </button>
      </form>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  borderRadius: 10,
  border: "none",
  background: "#8ab4f8",
  color: "#0e0e10",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: "1rem",
};

const secondaryBtn: React.CSSProperties = {
  padding: "0.6rem 1rem",
  borderRadius: 8,
  border: "1px solid #3a3a3e",
  background: "#1a1a1d",
  color: "#f2f2f2",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.6rem",
  borderRadius: 8,
  border: "1px solid #3a3a3e",
  background: "#1a1a1d",
  color: "#f2f2f2",
};
