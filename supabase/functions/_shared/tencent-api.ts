function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, value: string) {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(value));
}

export async function callTencentApi(input: {
  service: string;
  host: string;
  version: string;
  action: string;
  payload: Record<string, unknown>;
  secretId: string;
  secretKey: string;
  region?: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify(input.payload);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${input.host}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
  const scope = `${date}/${input.service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonicalRequest)}`;
  const secretDate = await hmacSha256(new TextEncoder().encode(`TC3${input.secretKey}`), date);
  const secretService = await hmacSha256(secretDate, input.service);
  const secretSigning = await hmacSha256(secretService, "tc3_request");
  const signature = bytesToHex(await hmacSha256(secretSigning, stringToSign));
  const authorization = `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await fetch(`https://${input.host}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": input.action,
      ...(input.region ? { "X-TC-Region": input.region } : {}),
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": input.version
    },
    body: payload
  });
  const result = await response.json();
  if (!response.ok || result.Response?.Error) throw new Error(result.Response?.Error?.Message || `腾讯云请求失败（${response.status}）`);
  return result.Response as Record<string, unknown>;
}
