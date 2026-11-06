import { APIGateway } from "@aws-sdk/client-api-gateway";
import {
  apiClient,
  forgedToken,
  getMissingScopeToken,
  getValidToken,
} from "../persona";

const api = new APIGateway();

describe("AuthenticatedRestApi", () => {
  // Increase the timeout We are making http calls which might have to spin up a cold lambda
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  let baseUrl: string;
  let validToken: string;
  let missingScopeToken: string;

  async function findApiGatewayId(
    position: string | undefined = undefined,
  ): Promise<string> {
    console.log(
      `Searching for API: ${process.env.AWS_PREFIX}simple-authenticated-rest-api`,
    );
    const response = await api.getRestApis({ position: position });

    if (!response.items) {
      throw Error("ApiGateway not found");
    }

    for (const item of response.items) {
      if (
        item.name ===
          `${process.env.AWS_PREFIX}simple-authenticated-rest-api` &&
        item.id
      ) {
        console.log(`Found API: ${item.name} with id ${item.id}`);
        return item.id;
      }
    }

    if (response.position) {
      return await findApiGatewayId(response.position);
    }

    throw Error("ApiGateway not found");
  }

  const client = (token?: string) => apiClient(baseUrl, token);

  beforeAll(async () => {
    const apiGatewayId = await findApiGatewayId();
    baseUrl = `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development/`;
    [validToken, missingScopeToken] = await Promise.all([
      getValidToken(),
      getMissingScopeToken(),
    ]);
  });

  test("returns 200 for unauthenticated route", async () => {
    const response = await client().get("simple-resource");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 1");
  });

  test("returns 401 without an Authorization header", async () => {
    expect((await client().post("simple-resource")).status).toBe(401);
  });

  test("returns 401 for an empty bearer token", async () => {
    expect((await client("").post("simple-resource")).status).toBe(401);
  });

  test.each([
    ["malformed", "not-a-jwt"],
    ["forged", forgedToken],
  ])("returns 403 for a %s token", async (_, token) => {
    expect((await client(token).post("simple-resource", {})).status).toBe(403);
  });

  test("returns 403 when token does not have the required scope", async () => {
    const response = await client(missingScopeToken).post(
      "simple-resource",
      {},
    );
    expect(response.status).toBe(403);
  });

  test("returns 200 and passes the principal on when authorised", async () => {
    const response = await client(validToken).post("simple-resource", {});
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
    expect(response.headers["x-principal-id"]).toBeTruthy();
  });

  test("only requires scopes on the methods that declare them", async () => {
    // PUT on the nested resource is authenticated but has no required scope
    const response = await client(missingScopeToken).put(
      "simple-resource/id1",
      {},
    );
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
  });

  test("returns 200 for a more deeply nested route", async () => {
    const response = await client().get(
      "simple-resource/id1/child-resource/id2",
    );
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 4");
  });
});
