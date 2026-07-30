import { describe, expect, it } from "vitest";
import { buildCosFederationPolicy } from "../../../supabase/functions/_shared/cos-policy";

describe("COS federation policy", () => {
  it("uses the COS APPID in prefix-scoped object resources", () => {
    const policy = buildCosFederationPolicy({
      bucket: "maplestorynk-private-1331200863",
      prefix: "drafts/22222222-2222-4222-8222-222222222222/",
      objectActions: ["name/cos:PutObject", "name/cos:UploadPart"],
      bucketActions: ["name/cos:ListMultipartUploads"]
    }, {
      region: "ap-guangzhou",
      appId: "1331200863"
    });

    expect(policy.statement).toEqual([
      {
        effect: "allow",
        action: ["name/cos:PutObject", "name/cos:UploadPart"],
        resource: [
          "qcs::cos:ap-guangzhou:uid/1331200863:maplestorynk-private-1331200863/drafts/22222222-2222-4222-8222-222222222222/*"
        ]
      },
      {
        effect: "allow",
        action: ["name/cos:ListMultipartUploads"],
        resource: ["qcs::cos:ap-guangzhou:uid/1331200863:maplestorynk-private-1331200863/*"]
      }
    ]);
    expect(policy.statement[1].action).not.toContain("name/cos:PutObject");
  });

});
