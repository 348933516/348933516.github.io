import { describe, expect, it } from "vitest";
import { toTransferableArrayBuffer } from "./documentWorkerBuffer";

describe("Word image buffers", () => {
  it("copies an ArrayBuffer view into an exact transferable ArrayBuffer", () => {
    const source = new Uint8Array([99, 10, 20, 30, 88]);
    const view = source.subarray(1, 4);

    const result = toTransferableArrayBuffer(view);

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(result)]).toEqual([10, 20, 30]);
    expect(result.byteLength).toBe(view.byteLength);
    expect(result).not.toBe(source.buffer);
  });

  it("keeps an existing ArrayBuffer without another full-size copy", () => {
    const source = new Uint8Array([10, 20, 30]).buffer;

    expect(toTransferableArrayBuffer(source)).toBe(source);
  });
});
