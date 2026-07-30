export interface CosFederationPolicyInput {
  bucket: string;
  prefix: string;
  objectActions: string[];
  bucketActions?: string[];
}

export interface CosFederationPolicyConfiguration {
  region: string;
  appId: string;
}

export function buildCosFederationPolicy(
  input: CosFederationPolicyInput,
  configuration: CosFederationPolicyConfiguration
) {
  const objectResource = `qcs::cos:${configuration.region}:uid/${configuration.appId}:${input.bucket}/${input.prefix}*`;
  const bucketResource = `qcs::cos:${configuration.region}:uid/${configuration.appId}:${input.bucket}/*`;
  const statement = [
    { effect: "allow", action: input.objectActions, resource: [objectResource] }
  ];
  if (input.bucketActions?.length) {
    statement.push({ effect: "allow", action: input.bucketActions, resource: [bucketResource] });
  }
  return { version: "2.0", statement };
}
