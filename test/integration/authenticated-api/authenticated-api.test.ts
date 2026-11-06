import { ApiGatewayV2 } from "@aws-sdk/client-apigatewayv2";
import { S3 } from "@aws-sdk/client-s3";
import {
  apiClient,
  forgedToken,
  getMissingScopeToken,
  getValidToken,
} from "../persona";

const api = new ApiGatewayV2();
const s3 = new S3();

const docsObject = {
  Bucket: `${process.env.AWS_PREFIX}simple-authenticated-api-docs`,
  Key: `api-documentation/index.html`,
};

describe("AuthenticatedApi", () => {
  // Increase the timeout We are making http calls which might have to spin up a cold lambda
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  let baseUrl: string;
  let validToken: string;
  let missingScopeToken: string;

  async function findApiGatewayId(
    nextToken: string | undefined = undefined,
  ): Promise<string> {
    const response = await api.getApis({ NextToken: nextToken });

    if (!response.Items) {
      throw Error("ApiGateway not found");
    }

    for (const item of response.Items) {
      if (
        item.Name === `${process.env.AWS_PREFIX}simple-authenticated-api` &&
        item.ApiId
      ) {
        return item.ApiId;
      }
    }

    if (response.NextToken) {
      return await findApiGatewayId(response.NextToken);
    }

    throw Error("ApiGateway not found");
  }

  const get = (path: string, token?: string) =>
    apiClient(baseUrl, token).get(path);

  beforeAll(async () => {
    const apiGatewayId = await findApiGatewayId();
    baseUrl = `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/`;
    [validToken, missingScopeToken] = await Promise.all([
      getValidToken(),
      getMissingScopeToken(),
    ]);
    await s3.putObject({
      ...docsObject,
      Body: "Simple Authenticated Api Documentation",
    });
  });

  afterAll(async () => {
    await s3.deleteObject(docsObject);
  });

  test("returns 200 for unauthenticated route", async () => {
    const response = await get("1/route2");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
  });

  test("returns 401 without an Authorization header", async () => {
    expect((await get("1/route1")).status).toBe(401);
  });

  test("returns 403 for an empty bearer token", async () => {
    // "Bearer " passes API Gateway's identity check, so the authorizer denies it
    expect((await get("1/route1", "")).status).toBe(403);
  });

  test.each([
    ["malformed", "not-a-jwt"],
    ["forged", forgedToken],
  ])("returns 403 for a %s token", async (_, token) => {
    expect((await get("1/route1", token)).status).toBe(403);
  });

  test("returns 200 and passes the client id on when authorised", async () => {
    const response = await get("1/route1", validToken);
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 1");
    expect(response.headers["x-client-id"]).toBeTruthy();
  });

  test.each([
    ["1/route1", "route 1"],
    ["1/route3/1234", "route 3"],
    ["1/route4/1234/route4", "route 4"],
  ])("enforces the required scope on %s", async (path, body) => {
    expect((await get(path, missingScopeToken)).status).toBe(403);

    const response = await get(path, validToken);
    expect(response.status).toBe(200);
    expect(response.data).toBe(body);
  });

  test("caches authorizer decisions per route, not per token", async () => {
    // route5 needs no scope; route1 needs one this token lacks
    expect((await get("1/route5", missingScopeToken)).status).toBe(200);
    expect((await get("1/route1", missingScopeToken)).status).toBe(403);
    expect((await get("1/route5", missingScopeToken)).status).toBe(200);
  });

  test("returns 200 when routing to a url", async () => {
    const response = await get("api-documentation");
    expect(response.status).toBe(200);
    expect(response.data).toBe("Simple Authenticated Api Documentation");
  });

  test("authorizes url routes and enforces their required scope", async () => {
    const path = "1/admin-documentation";
    expect((await get(path)).status).toBe(401);
    expect((await get(path, missingScopeToken)).status).toBe(403);

    const response = await get(path, validToken);
    expect(response.status).toBe(200);
    expect(response.data).toBe("Simple Authenticated Api Documentation");
  });
});
