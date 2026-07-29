import { describe, expect, it } from "vitest";
import type { MediaStorageMigrationStatus } from "../../lib/repository";
import { mediaMigrationReadyToCommit } from "./SystemAdmin";

function migrationWith(statuses: MediaStorageMigrationStatus["items"][number]["status"][]): MediaStorageMigrationStatus {
  return {
    job: {
      id: "migration-1",
      status: "verifying",
      total_objects: statuses.length,
      completed_objects: statuses.filter((status) => status === "verified" || status === "committed").length,
      total_bytes: 100,
      completed_bytes: 100
    },
    items: statuses.map((status, index) => ({
      id: index + 1,
      source_bucket: "maplestorynk-public",
      source_path: `media/${index + 1}.png`,
      destination_bucket: "maplestorynk-media-1331200863",
      destination_path: `media/${index + 1}.png`,
      size_bytes: 50,
      status,
      retry_count: 0
    }))
  };
}

describe("COS media migration confirmation", () => {
  it("allows final cutover only after every object is verified", () => {
    expect(mediaMigrationReadyToCommit(null)).toBe(false);
    expect(mediaMigrationReadyToCommit(migrationWith([]))).toBe(false);
    expect(mediaMigrationReadyToCommit(migrationWith(["verified", "pending"]))).toBe(false);
    expect(mediaMigrationReadyToCommit(migrationWith(["verified", "committed"]))).toBe(true);
  });

  it("never allows a cancelled migration to cut over", () => {
    const cancelled = migrationWith(["verified", "committed"]);
    cancelled.job.status = "cancelled";
    expect(mediaMigrationReadyToCommit(cancelled)).toBe(false);
  });
});
