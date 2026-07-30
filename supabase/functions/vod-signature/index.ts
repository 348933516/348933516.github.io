import { edgeHandler, json, requireRole } from "../_shared/auth.ts";
import { functionError } from "../_shared/function-errors.ts";

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

Deno.serve((request) => edgeHandler(request, async () => {
  await requireRole(request, ["super_admin", "editor", "uploader"]);
  if (Deno.env.get("TENCENT_VOD_ENABLED") !== "true") {
    return json(functionError("VOD_DISABLED", "VOD is disabled; upload compatible videos to COS", "signature"), 409);
  }
  const secretId = Deno.env.get("TENCENT_VOD_SECRET_ID") || "";
  const secretKey = Deno.env.get("TENCENT_VOD_SECRET_KEY") || "";
  const appId = Number(Deno.env.get("TENCENT_VOD_APP_ID") || 0);
  const subAppId = Number(Deno.env.get("TENCENT_VOD_SUB_APP_ID") || 0);
  const procedure = Deno.env.get("TENCENT_VOD_PROCEDURE") || "";
  if (!secretId || !secretKey || !appId || !procedure) {
    return json(functionError("VOD_CONFIG_MISSING", "VOD configuration is incomplete", "signature"), 503);
  }
  const currentTime = Math.floor(Date.now() / 1000);
  const values = [
    `secretId=${encodeURIComponent(secretId)}`,
    `currentTime=${currentTime}`,
    `expireTime=${currentTime + 3600}`,
    `random=${crypto.getRandomValues(new Uint32Array(1))[0]}`,
    ...(subAppId ? [`vodSubAppId=${subAppId}`] : []),
    `procedure=${encodeURIComponent(procedure)}`
  ];
  const original = new TextEncoder().encode(values.join("&"));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secretKey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, original));
  const signed = new Uint8Array(digest.length + original.length);
  signed.set(digest);
  signed.set(original, digest.length);
  return json({ signature: bytesToBase64(signed), appId, subAppId: subAppId || null });
}));
