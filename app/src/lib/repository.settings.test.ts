import { describe, expect, it } from "vitest";
import { mapSettings } from "./repository";

describe("site settings mapping", () => {
  it("maps the configured favicon through the selected storage provider", () => {
    const settings = mapSettings({
      favicon_path: "site/settings/favicon/icon.png",
      favicon_provider: "tencent_cos"
    });
    expect(settings.faviconUrl).toBe("https://media.maplestorynk.online/site/settings/favicon/icon.png");
  });
});
