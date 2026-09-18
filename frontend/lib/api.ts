const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function mediaUrl(path: string) {
  if (!path) return path;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_URL}${path}`;
}

export async function checkIdentity(identity_type: "serial" | "barcode", identity_value: string) {
  const res = await fetch(`${API_URL}/things/check-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity_type, identity_value }),
  });
  if (!res.ok) throw new Error("check-identity failed");
  return res.json() as Promise<{ available: boolean; existing_onekey_code?: string }>;
}

export async function claimThing(form: FormData) {
  const res = await fetch(`${API_URL}/things/claim`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "claim failed");
  }
  return res.json();
}

export async function getThing(code: string) {
  const res = await fetch(`${API_URL}/things/${code}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("failed to load thing");
  return res.json();
}
