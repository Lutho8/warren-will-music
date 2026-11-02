// Server-only shared artist access. Never return verifier material to clients.
export async function matchesSharedClientCode(sb: any, provided: string): Promise<boolean> {
  if (!provided || provided.length > 256) return false;
  const { data, error } = await sb.from("crm_shared_access")
    .select("salt,code_hash,iterations").eq("id", "warren_shared").eq("enabled", true).maybeSingle();
  if (error || !data) return false;
  const iterations = Number(data.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 ||
      !/^[0-9a-f]{64}$/.test(data.code_hash)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(provided),
    "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(data.salt), iterations
  }, key, 256);
  const digest = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, "0")).join("");
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest.charCodeAt(i) ^ data.code_hash.charCodeAt(i);
  return difference === 0;
}
