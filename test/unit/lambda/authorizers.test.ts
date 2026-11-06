import type { APIGatewayRequestAuthorizerEventV2 } from "aws-lambda";
import {
  httpApiHandler,
  pathMatches,
  requiredScope,
  resourcePathFromArn,
  restApiHandler,
} from "../../../src/lambda/authorizers";
import { nowSeconds, personaFetch, signJwt } from "./jwt";

const ARN =
  "arn:aws:execute-api:eu-west-1:123456789012:api-id/stage/GET/1/route1";

// Only the fields the authorizer reads; API Gateway sends many more
function httpApiEvent(authorization?: string) {
  const event: Partial<APIGatewayRequestAuthorizerEventV2> = {
    type: "REQUEST",
    routeArn: ARN,
    headers: { authorization },
  };
  return event as APIGatewayRequestAuthorizerEventV2;
}

beforeEach(() => {
  vi.stubGlobal("fetch", personaFetch());
  vi.stubEnv("SCOPE_CONFIG", JSON.stringify({ "/1/route1": "read" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resourcePathFromArn", () => {
  test.each([
    [
      "arn:aws:execute-api:us-west-2:123456789012:api-id/stage/GET/resource",
      "/resource",
    ],
    [
      "arn:aws:execute-api:eu-west-1:302477901552:atpstdpb1c/*/PUT/simple-resource/{simpleResourceId}",
      "/simple-resource/{simpleResourceId}",
    ],
    ["arn:aws:execute-api:eu-west-1:1:api/stage/GET/", "/"],
    ["arn:aws:execute-api:eu-west-1:1:api/stage/GET/a:b/c", "/a:b/c"],
  ])("%s -> %s", (arn, expected) => {
    expect(resourcePathFromArn(arn)).toBe(expected);
  });
});

describe("pathMatches", () => {
  test.each([
    ["/1/route1", "/1/route1", true],
    ["/1/route1", "/1/route2", false],
    ["/1/a/b/route1", "/1/a/b/route1", true],
    ["/1/route1/{id}", "/1/route1/test_id", true],
    ["/1/route1/:id", "/1/route1/test_id", false],
    ["/1/a/{id}/route1", "/1/a/test_id/route1", true],
    ["/a/b/route1", "/a/b/c/route1", false],
  ])("%s vs %s -> %s", (definition, path, expected) => {
    expect(pathMatches(definition, path)).toBe(expected);
  });
});

describe("requiredScope", () => {
  test("returns the scope of the first matching path", () => {
    vi.stubEnv(
      "SCOPE_CONFIG",
      JSON.stringify({ "/a/{id}": "first", "/a/b": "second" }),
    );
    expect(requiredScope("/a/b")).toBe("first");
    expect(requiredScope("/c")).toBeUndefined();
  });

  test("returns undefined without SCOPE_CONFIG", () => {
    vi.stubEnv("SCOPE_CONFIG", undefined);
    expect(requiredScope("/a")).toBeUndefined();
  });
});

describe("httpApiHandler", () => {
  const invoke = (authorization?: string) =>
    httpApiHandler(httpApiEvent(authorization));

  test("authorizes a valid token with the required scope", async () => {
    const token = signJwt({ sub: "client", scopes: ["read"] });
    await expect(invoke(`Bearer ${token}`)).resolves.toEqual({
      isAuthorized: true,
      context: { clientId: "client" },
    });
  });

  test("reports an insufficient scope", async () => {
    const token = signJwt({ sub: "client", scopes: ["write"] });
    await expect(invoke(`Bearer ${token}`)).resolves.toEqual({
      isAuthorized: false,
      context: { description: "Insufficient Scope", clientId: "client" },
    });
  });

  test("denies an invalid token", async () => {
    const token = signJwt({ sub: "client", exp: nowSeconds() - 1 });
    await expect(invoke(`Bearer ${token}`)).resolves.toEqual({
      isAuthorized: false,
      context: { clientId: "" },
    });
  });

  test("denies when Persona is unreachable", async () => {
    vi.resetModules(); // fresh module without a cached public key
    const { httpApiHandler } =
      await import("../../../src/lambda/authorizers.js");
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      httpApiHandler(httpApiEvent(`Bearer ${signJwt({ sub: "client" })}`)),
    ).resolves.toEqual({ isAuthorized: false, context: { clientId: "" } });
  });

  test.each([undefined, "", "Bearer ", "Bearer"])(
    "throws Unauthorized for authorization header %j",
    async (header) => {
      await expect(invoke(header)).rejects.toThrow("Unauthorized");
    },
  );
});

describe("restApiHandler", () => {
  const invoke = (authorizationToken: string) =>
    restApiHandler({ type: "TOKEN", authorizationToken, methodArn: ARN });
  const policy = (effect: string) => ({
    Version: "2012-10-17",
    Statement: [
      { Action: "execute-api:Invoke", Effect: effect, Resource: [ARN] },
    ],
  });

  test("allows a valid token, using its aud as principal", async () => {
    const token = signJwt({ aud: "client-id", scopes: ["read"] });
    await expect(invoke(`Bearer ${token}`)).resolves.toEqual({
      principalId: "client-id",
      policyDocument: policy("Allow"),
    });
  });

  test("denies a token without the required scope", async () => {
    const token = signJwt({ aud: "client-id", scopes: ["write"] });
    await expect(invoke(`Bearer ${token}`)).resolves.toEqual({
      principalId: "",
      policyDocument: policy("Deny"),
    });
  });

  test("throws Unauthorized for an empty token", async () => {
    await expect(invoke("")).rejects.toThrow("Unauthorized");
  });
});
