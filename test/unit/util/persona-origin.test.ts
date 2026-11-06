import * as cdk from "aws-cdk-lib";
import { resolvePersonaOrigin } from "../../../lib/util/persona-origin";

const persona = { host: "users.talis.com", scheme: "https", port: "443" };

describe("resolvePersonaOrigin", () => {
  test("builds the origin from the persona props", () => {
    expect(resolvePersonaOrigin({ persona })).toBe(
      "https://users.talis.com:443",
    );
  });

  test("ignores the deprecated oauth_route", () => {
    expect(
      resolvePersonaOrigin({ persona: { ...persona, oauth_route: "/x" } }),
    ).toBe("https://users.talis.com:443");
  });

  test.each(["https://users.talis.com", "http://localhost:3000"])(
    "returns personaOrigin %s as is",
    (personaOrigin) => {
      expect(resolvePersonaOrigin({ personaOrigin })).toBe(personaOrigin);
    },
  );

  test("accepts an unresolved token", () => {
    const personaOrigin = cdk.Lazy.string({ produce: () => "x" });
    expect(resolvePersonaOrigin({ personaOrigin })).toBe(personaOrigin);
  });

  test("rejects both persona and personaOrigin", () => {
    expect(() =>
      resolvePersonaOrigin({
        persona,
        personaOrigin: "https://users.talis.com",
      }),
    ).toThrow("Set either persona or personaOrigin, not both");
  });

  test("rejects neither persona nor personaOrigin", () => {
    expect(() => resolvePersonaOrigin({})).toThrow(
      "Set either persona or personaOrigin",
    );
  });

  test.each([
    "users.talis.com",
    "https://users.talis.com/",
    "https://users.talis.com/3",
    "",
  ])("rejects %j, which is not an origin", (personaOrigin) => {
    expect(() => resolvePersonaOrigin({ personaOrigin })).toThrow(
      "personaOrigin must be an origin",
    );
  });
});
