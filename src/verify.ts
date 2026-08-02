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
export async function alreadyHandled(txHash: string): Promise<boolean> {
  const cache = caches.default;
  const key = new Request(`https://dedupe.local/${txHash}`);
  const hit = await cache.match(key);
  if (hit) return true;
  await cache.put(key, new Response("1", { headers: { "Cache-Control": "max-age=86400" } }));
  return false;
}
