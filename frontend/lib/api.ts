const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://onekey-api-25cg.onrender.com";

export function mediaUrl(path: string, onekeyCode?: string) {
  // Current records use Supabase Storage URLs. Keep those URLs intact.
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  // Legacy/backend-relative photo paths are served through the API proxy.
  if (onekeyCode && path.startsWith("/media/")) return `${API_URL}/things/${onekeyCode}/photo`;
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


export async function requestTransfer(
  code: string,
  payload: {
    current_owner_contact: string;
    new_owner_contact: string;
    new_owner_display_name: string;
  },
) {
  const res = await fetch(`${API_URL}/things/${code}/transfer/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "transfer request failed");
  }
  return res.json() as Promise<{ transfer_id: string; status: string }>;
}

export async function confirmTransfer(transferId: string, token: string) {
  const res = await fetch(
    `${API_URL}/things/transfer/${transferId}/confirm?token=${encodeURIComponent(token)}`,
    { method: "POST" },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || "transfer confirmation failed");
  }
  return res.json() as Promise<{
    transfer_id: string;
    status: string;
    completed_at?: string;
    message?: string;
  }>;
}
