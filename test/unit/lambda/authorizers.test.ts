// The authorizers read SCOPE_CONFIG once, when the module loads
vi.hoisted(() => {
  process.env.SCOPE_CONFIG = JSON.stringify({
    "GET /items/{id}": "read",
    "ANY /admin": "admin",
  });
});

import type {
  APIGatewayRequestAuthorizerEvent,
  APIGatewayRequestAuthorizerEventV2,
} from "aws-lambda";
import {
  httpApiHandler,
  requiredScope,
  restApiHandler,
} from "../../../src/lambda/authorizers";
import { nowSeconds, personaFetch, signJwt } from "../../fixtures/jwt";

const ARN =
  "arn:aws:execute-api:eu-west-1:123456789012:api-id/stage/GET/items/1";

// Only the fields the authorizers read; API Gateway sends many more
function httpApiEvent(
  headers: Record<string, string | undefined>,
  routeKey = "GET /items/{id}",
) {
  const event: Partial<APIGatewayRequestAuthorizerEventV2> = {
    type: "REQUEST",
    routeArn: ARN,
    routeKey,
    headers,
  };
  return event as APIGatewayRequestAuthorizerEventV2;
}

function restApiEvent(
  headers: Record<string, string | undefined>,
  httpMethod = "GET",
) {
  const event: Partial<APIGatewayRequestAuthorizerEvent> = {
    type: "REQUEST",
    methodArn: ARN,
    httpMethod,
    resource: "/items/{id}",
    headers,
  };
  return event as APIGatewayRequestAuthorizerEvent;
}

const bearer = (payload: object) => `Bearer ${signJwt(payload)}`;

beforeEach(() => {
  vi.stubGlobal("fetch", personaFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requiredScope", () => {
  test("looks up the exact method and route", () => {
    expect(requiredScope("GET /items/{id}")).toBe("read");
    expect(requiredScope("POST /items/{id}")).toBeUndefined();
    expect(requiredScope("GET /items")).toBeUndefined();
    expect(requiredScope("constructor")).toBeUndefined();
  });

  test("falls back to an ANY method on the same route", () => {
    expect(requiredScope("POST /admin")).toBe("admin");
    expect(requiredScope("ANY /admin")).toBe("admin");
    expect(requiredScope("POST /admin/x")).toBeUndefined();
  });

  test("returns undefined without SCOPE_CONFIG", async () => {
    vi.stubEnv("SCOPE_CONFIG", undefined);
    vi.resetModules();
    const { requiredScope } =
      await import("../../../src/lambda/authorizers.js");
    expect(requiredScope("GET /items/{id}")).toBeUndefined();
  });
});

describe("httpApiHandler", () => {
  const invoke = (authorization?: string, routeKey?: string) =>
    httpApiHandler(httpApiEvent({ authorization }, routeKey));

  test("authorizes a valid token with the required scope", async () => {
    await expect(
      invoke(bearer({ sub: "client", scopes: ["read"] })),
    ).resolves.toEqual({ isAuthorized: true, context: { clientId: "client" } });
  });

  test("reports an insufficient scope", async () => {
    await expect(
      invoke(bearer({ sub: "client", scopes: ["write"] })),
    ).resolves.toEqual({
      isAuthorized: false,
      context: { description: "Insufficient Scope", clientId: "client" },
    });
  });

  test("only requires the scope configured for the route", async () => {
    await expect(
      invoke(bearer({ sub: "client", scopes: [] }), "POST /items/{id}"),
    ).resolves.toMatchObject({ isAuthorized: true });
  });

  test("denies an invalid token", async () => {
    await expect(
      invoke(bearer({ sub: "client", exp: nowSeconds() - 1 })),
    ).resolves.toEqual({ isAuthorized: false, context: { clientId: "" } });
  });

  test("denies when Persona is unreachable", async () => {
    vi.resetModules(); // fresh module without a cached public key
    const { httpApiHandler } =
      await import("../../../src/lambda/authorizers.js");
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      httpApiHandler(httpApiEvent({ authorization: bearer({ sub: "c" }) })),
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
  const invoke = (
    headers: Record<string, string | undefined>,
    method?: string,
  ) => restApiHandler(restApiEvent(headers, method));
  const policy = (effect: string) => ({
    Version: "2012-10-17",
    Statement: [
      { Action: "execute-api:Invoke", Effect: effect, Resource: [ARN] },
    ],
  });

  test("allows a valid token, using its aud as principal", async () => {
    await expect(
      invoke({ Authorization: bearer({ aud: "client-id", scopes: ["read"] }) }),
    ).resolves.toEqual({
      principalId: "client-id",
      policyDocument: policy("Allow"),
    });
  });

  test("denies a token without the required scope", async () => {
    await expect(
      invoke({
        Authorization: bearer({ aud: "client-id", scopes: ["write"] }),
      }),
    ).resolves.toEqual({ principalId: "", policyDocument: policy("Deny") });
  });

  test("only requires the scope configured for the method", async () => {
    await expect(
      invoke(
        { Authorization: bearer({ aud: "client-id", scopes: [] }) },
        "PUT",
      ),
    ).resolves.toMatchObject({ policyDocument: policy("Allow") });
  });

  test("reads the authorization header case-insensitively", async () => {
    await expect(
      invoke({ authorization: bearer({ aud: "client-id", scopes: ["read"] }) }),
    ).resolves.toMatchObject({ policyDocument: policy("Allow") });
  });

  test.each([{}, { Authorization: "" }, { Authorization: "Bearer" }])(
    "throws Unauthorized for headers %j",
    async (headers) => {
      await expect(invoke(headers)).rejects.toThrow("Unauthorized");
    },
  );
});

describe("X-Request-Id sent to Persona", () => {
  // scopeCount forces a call to Persona on every request
  const remoteScopeToken = bearer({ sub: "client", scopeCount: 50 });
  const sentRequestId = () =>
    (vi.mocked(fetch).mock.lastCall?.[1]?.headers as Record<string, string>)[
      "X-Request-Id"
    ];

  test("forwards the caller's X-Request-Id (HTTP API)", async () => {
    await httpApiHandler(
      httpApiEvent({
        authorization: remoteScopeToken,
        "x-request-id": "caller-id",
      }),
    );
    expect(sentRequestId()).toBe("caller-id");
  });

  test("forwards the caller's X-Request-Id (REST API)", async () => {
    await restApiHandler(
      restApiEvent({
        Authorization: remoteScopeToken,
        "X-Request-Id": "caller-id",
      }),
    );
    expect(sentRequestId()).toBe("caller-id");
  });

  test.each([undefined, ""])(
    "generates one when the caller sends %j",
    async (requestId) => {
      await httpApiHandler(
        httpApiEvent({
          authorization: remoteScopeToken,
          "x-request-id": requestId,
        }),
      );
      expect(sentRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
