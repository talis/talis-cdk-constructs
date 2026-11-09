import { getTalisProductForApp } from "../../../lib";

describe("getTalisProductForApp", () => {
  test.each([
    ["depot-serverless", "depot"],
    ["census-server", "census"],
    ["citeproc-lambda", "tarl"],
    ["serverless-clamscan", "platform-tooling"],
    ["crossref-metadata-import", "crossref"],
  ])("maps %s to %s", (app, product) => {
    expect(getTalisProductForApp(app)).toBe(product);
  });

  it("falls back to the app name for unmapped apps", () => {
    expect(getTalisProductForApp("metatron-prime")).toBe("metatron-prime");
  });
});
