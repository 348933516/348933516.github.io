import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Hex } from "./hash";

describe("portable SHA-256", () => {
  it("hashes without relying on crypto.subtle", () => {
    const input = new TextEncoder().encode("abc");

    expect(sha256Hex(input)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Bytes(input)).toHaveLength(32);
  });

  it("hashes only the selected bytes of an ArrayBuffer view", () => {
    const input = new Uint8Array([99, 97, 98, 99, 88]).subarray(1, 4);

    expect(sha256Hex(input)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
