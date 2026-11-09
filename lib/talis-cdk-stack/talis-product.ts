// talis:product value for each tfs-app (PLT-2712). Products are the PLT-2831
// application names; apps not listed use their own app name.
const TALIS_PRODUCT_BY_APP: Readonly<Record<string, string>> = {
  "bibliographic-resource-collector-serverless": "tarl",
  "blueprint-serverless": "blueprint",
  catalyst: "elevate",
  "census-server": "census",
  "citeproc-lambda": "tarl",
  "content-linking-monorepo": "content-linking",
  "crossref-metadata-import": "crossref",
  "depot-serverless": "depot",
  "development-ml-crossref-metatdata-import-app": "crossref",
  "echo-serverless": "echo",
  "hippo-prototype-backend": "consulting",
  otis: "elevate",
  "s3-retroactive-encryption": "platform-tooling",
  "serverless-clamscan": "platform-tooling",
  "smalti-admin-ui": "smalti",
  "smalti-serverless": "smalti",
  "tfs-cdk-aws-alerts": "platform-tooling",
  "user-utils": "persona",
};

export function getTalisProductForApp(app: string): string {
  return TALIS_PRODUCT_BY_APP[app] ?? app;
}
