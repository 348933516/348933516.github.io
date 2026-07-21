import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

function asBytes(value: ArrayBuffer | ArrayBufferView) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

export function sha256Bytes(value: ArrayBuffer | ArrayBufferView) {
  return sha256(asBytes(value));
}

export function sha256Hex(value: ArrayBuffer | ArrayBufferView) {
  return bytesToHex(sha256Bytes(value));
}
