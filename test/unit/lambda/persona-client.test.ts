import { generateKeyPairSync } from "node:crypto";
import {
  hasAnyScope,
  PersonaClient,
  PersonaError,
  verifyJwt,
} from "../../../src/lambda/persona-client";
import { nowSeconds, personaFetch, publicKey, signJwt } from "./jwt";

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectValidationFailure(token: string) {
  expect(() => verifyJwt(token, publicKey)).toThrow(
    expect.objectContaining({ type: "validation_failure" }),
  );
}

describe("verifyJwt", () => {
  test("returns the payload of a valid token", () => {
    const payload = { sub: "client", exp: nowSeconds() + 60 };
    expect(verifyJwt(signJwt(payload), publicKey)).toEqual(payload);
  });

  test("accepts a token without exp or nbf", () => {
    expect(verifyJwt(signJwt({ sub: "client" }), publicKey)).toEqual({
      sub: "client",
    });
  });

  test("rejects a token signed with another key", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expectValidationFailure(signJwt({ sub: "x" }, { key: other.privateKey }));
  });

  test("rejects a tampered payload", () => {
    const [header, , signature] = signJwt({ sub: "a" }).split(".");
    const forged = Buffer.from('{"sub":"admin"}').toString("base64url");
    expectValidationFailure(`${header}.${forged}.${signature}`);
  });

  test.each(["none", "HS256", "RS512"])("rejects alg %s", (alg) => {
    expectValidationFailure(signJwt({ sub: "x" }, { alg }));
  });

  test("rejects an unsigned token", () => {
    const [header, payload] = signJwt({ sub: "x" }, { alg: "none" }).split(".");
    expectValidationFailure(`${header}.${payload}.`);
  });

  test.each([
    ["expired", { exp: nowSeconds() - 1 }],
    ["expiring now", { exp: nowSeconds() }],
    ["not yet valid", { nbf: nowSeconds() + 60 }],
    ["non-numeric exp", { exp: "never" }],
    ["non-numeric nbf", { nbf: "now" }],
  ])("rejects a token that is %s", (_, claims) => {
    expectValidationFailure(signJwt({ sub: "x", ...claims }));
  });

  test.each([
    ["empty", ""],
    ["two segments", "a.b"],
    ["four segments", `${signJwt({})}.extra`],
    ["garbage", "not.a.jwt"],
    ["array payload", signJwt(["sub"])],
  ])("rejects a malformed token (%s)", (_, token) => {
    expectValidationFailure(token);
  });
});

describe("hasAnyScope", () => {
  test.each([
    [["read"], ["read"], true],
    [["read"], ["write"], false],
    [["read", "write"], ["admin", "write"], true],
    [["su"], ["anything"], true],
    [["ns@read"], ["ns@read"], true],
    [["ns@read"], ["other@read"], false],
    [["ns@read"], ["read"], false],
    [["read"], ["ns@read"], false],
    [["su@provider"], ["provider"], true],
    [["su@provider"], ["provider:foo"], true],
    [["su@provider"], ["providerfoo"], false],
    [["su@provider"], ["x@provider"], true],
    [[], ["read"], false],
  ])("granted %j, required %j -> %s", (granted, required, expected) => {
    expect(hasAnyScope(granted, required)).toBe(expected);
  });
});

describe("PersonaClient.validateToken", () => {
  const client = () =>
    new PersonaClient("https://persona.test:443", "test-agent");

  test("fetches the public key once and caches it", async () => {
    const fetch = personaFetch();
    vi.stubGlobal("fetch", fetch);
    const persona = client();
    const token = signJwt({ sub: "client" });

    await expect(persona.validateToken(token)).resolves.toEqual({
      sub: "client",
    });
    await persona.validateToken(token);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      "https://persona.test:443/3/oauth/keys",
    );
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({
      "User-Agent": "test-agent",
    });
  });

  test("reports a communication issue when the key cannot be fetched", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 500 }));
    await expect(
      client().validateToken(signJwt({ sub: "x" })),
    ).rejects.toMatchObject({ type: "communication_issue" });
  });

  test("checks scopes embedded in the token", async () => {
    vi.stubGlobal("fetch", personaFetch());
    const persona = client();
    const token = signJwt({ sub: "client", scopes: ["read"] });

    await expect(persona.validateToken(token, ["read"])).resolves.toBeTruthy();
    const error = await persona
      .validateToken(token, ["write"])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PersonaError);
    expect(error).toMatchObject({
      type: "insufficient_scope",
      token: { sub: "client" },
    });
  });

  test.each([
    [204, undefined],
    [401, "validation_failure"],
    [403, "insufficient_scope"],
    [500, "communication_issue"],
  ])(
    "asks Persona when the token only has a scopeCount (HEAD %i)",
    async (status, errorType) => {
      const fetch = personaFetch(status);
      vi.stubGlobal("fetch", fetch);
      const token = signJwt({ sub: "client", scopeCount: 50 });

      const result = client().validateToken(token, ["ns@read", "write"]);

      if (errorType) {
        await expect(result).rejects.toMatchObject({
          type: errorType,
          token: { sub: "client" },
        });
      } else {
        await expect(result).resolves.toMatchObject({ sub: "client" });
      }
      const [url, init] = fetch.mock.calls[1];
      expect(init?.method).toBe("HEAD");
      expect(url).toBe(
        `https://persona.test:443/3/oauth/tokens/${token}?scope=ns%40read,write`,
      );
    },
  );
});
