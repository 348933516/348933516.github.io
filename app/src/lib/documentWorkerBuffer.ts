export function toTransferableArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;
}
