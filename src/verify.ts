export async function verifyAlchemySignature(
  body: string,
  signature: string,
  signingKey: string,
): Promise<boolean> {
  if (!signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

// Dedupe via the Workers Cache API (free, no per-day write cap unlike KV).
function dedupeKey(txHash: string): Request {
  return new Request(`https://dedupe.local/${txHash}`);
}

export async function alreadyHandled(txHash: string): Promise<boolean> {
  return (await caches.default.match(dedupeKey(txHash))) !== undefined;
}

// Called only after a tx is fully processed, so a failed RPC fetch lets Alchemy's retry try again.
export async function markHandled(txHash: string): Promise<void> {
  await caches.default.put(dedupeKey(txHash), new Response("1", { headers: { "Cache-Control": "max-age=86400" } }));
}
