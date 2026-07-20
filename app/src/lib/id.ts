type CryptoLike = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

export function randomId(
  cryptoApi: CryptoLike | null | undefined = globalThis.crypto,
  now = () => Date.now(),
  random = () => Math.random()
) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  // HTTP previews can expose neither randomUUID nor getRandomValues. Imported
  // media IDs still have to satisfy Postgres' UUID type in that environment.
  const seed = now().toString(16).padStart(12, "0").slice(-12);
  const randomHex = () => Math.floor(Math.max(0, Math.min(0.9999999999999999, random())) * 0x100000000).toString(16).padStart(8, "0");
  const entropy = `${randomHex()}${randomHex()}${randomHex()}${randomHex()}`;
  return `${entropy.slice(0, 8)}-${seed.slice(0, 4)}-4${seed.slice(4, 7)}-8${entropy.slice(8, 11)}-${entropy.slice(11, 23)}`;
}
