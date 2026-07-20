function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(value));
}

export function vodConfiguration() {
  const secretId = Deno.env.get("TENCENT_VOD_SECRET_ID") || "";
  const secretKey = Deno.env.get("TENCENT_VOD_SECRET_KEY") || "";
  const appId = Number(Deno.env.get("TENCENT_VOD_APP_ID") || 0);
  const subAppId = Number(Deno.env.get("TENCENT_VOD_SUB_APP_ID") || 0);
  const procedure = Deno.env.get("TENCENT_VOD_PROCEDURE") || "";
  if (!secretId || !secretKey || !appId || !procedure) throw new Error("腾讯云点播尚未配置");
  return { secretId, secretKey, appId, subAppId, procedure };
}

export async function callTencentVod(action: string, input: Record<string, unknown>) {
  const configuration = vodConfiguration();
  const host = "vod.tencentcloudapi.com";
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({ ...input, ...(configuration.subAppId ? { SubAppId: configuration.subAppId } : {}) });
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
  const scope = `${date}/vod/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonicalRequest)}`;
  const secretDate = await hmac(new TextEncoder().encode(`TC3${configuration.secretKey}`), date);
  const secretService = await hmac(secretDate, "vod");
  const secretSigning = await hmac(secretService, "tc3_request");
  const signature = bytesToHex(await hmac(secretSigning, stringToSign));
  const authorization = `TC3-HMAC-SHA256 Credential=${configuration.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": "2018-07-17"
    },
    body: payload
  });
  const result = await response.json();
  if (!response.ok || result.Response?.Error) throw new Error(result.Response?.Error?.Message || `腾讯云请求失败（${response.status}）`);
  return result.Response as Record<string, unknown>;
}
