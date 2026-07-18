import { describe, expect, it } from "vitest";
import { randomId } from "./id";

describe("randomId", () => {
  it("uses randomUUID when available", () => {
    expect(randomId({ randomUUID: () => "native-id" })).toBe("native-id");
  });

  it("generates a UUID-shaped value from random bytes", () => {
    const value = randomId({ getRandomValues: (bytes) => bytes.fill(7) });
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("falls back without a crypto implementation", () => {
    expect(randomId(null, () => 1234, () => 0.5)).toBe("ya-i");
  });
});
