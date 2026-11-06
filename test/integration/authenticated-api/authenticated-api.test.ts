import axios from "axios";
import { ApiGatewayV2, S3 } from "aws-sdk";

const api = new ApiGatewayV2();

const TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT =
  process.env.TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT ?? "";
const TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET =
  process.env.TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET ?? "";
const TALIS_CDK_AUTH_API_VALID_CLIENT =
  process.env.TALIS_CDK_AUTH_API_VALID_CLIENT ?? "";
const TALIS_CDK_AUTH_API_VALID_SECRET =
  process.env.TALIS_CDK_AUTH_API_VALID_SECRET ?? "";

const s3 = new S3();

describe("AuthenticatedApi", () => {
  // Increase the timeout We are making http calls which might have to spin up a cold lambda
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  let apiGatewayId: string;

  async function findApiGatewayId(
    nextToken: string | undefined = undefined,
  ): Promise<string> {
    const response = await api.getApis({ NextToken: nextToken }).promise();

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

  async function getOAuthToken(
    client: string,
    secret: string,
  ): Promise<string> {
    const postData = "grant_type=client_credentials";
    const response = await axios.post(
      "https://staging-users.talis.com/oauth/tokens",
      postData,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": `${postData.length}`,
        },
        auth: {
          username: client,
          password: secret,
        },
      },
    );

    return response.data.access_token;
  }

  async function uploadExampleDocumentation() {
    await s3
      .putObject({
        Bucket: `${process.env.AWS_PREFIX}simple-authenticated-api-docs`,
        Key: `api-documentation/index.html`,
        Body: "Simple Authenticated Api Documentation",
      })
      .promise();
  }

  async function deleteExampleDocumentation() {
    await s3
      .deleteObject({
        Bucket: `${process.env.AWS_PREFIX}simple-authenticated-api-docs`,
        Key: `api-documentation/index.html`,
      })
      .promise();
  }

  beforeAll(async () => {
    apiGatewayId = await findApiGatewayId();
    await uploadExampleDocumentation();
  });

  afterAll(async () => {
    await deleteExampleDocumentation();
  });

  test("returns 200 for unauthenticated route", async () => {
    const axiosNoAuthInstance = axios.create({
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
    });
    const response = await axiosNoAuthInstance.get("route2");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
  });

  test("returns 401 for authenticated route", async () => {
    try {
      const axiosNoAuthInstance = axios.create({
        baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
      });
      await axiosNoAuthInstance.get("route1");
      throw Error("Expected a 401 response");
    } catch (err) {
      expect((err as Error).message).toBe(
        "Request failed with status code 401",
      );
    }
  });

  test("returns 403 when token does not have required scope", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT,
      TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET,
    );
    try {
      const axiosBadAuthInstance = axios.create({
        headers: { Authorization: `Bearer ${token}` },
        baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
      });
      await axiosBadAuthInstance.get("route1");
      throw Error("Expected a 403 response");
    } catch (err) {
      expect((err as Error).message).toBe(
        "Request failed with status code 403",
      );
    }
  });

  test("returns 200 when authorised", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_VALID_CLIENT,
      TALIS_CDK_AUTH_API_VALID_SECRET,
    );
    const axiosAuthInstance = axios.create({
      headers: { Authorization: `Bearer ${token}` },
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
    });
    const response = await axiosAuthInstance.get("route1");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 1");
  });

  test("returns 200 when routing to a url", async () => {
    const axiosAuthInstance = axios.create({
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/`,
    });
    const response = await axiosAuthInstance.get("api-documentation");
    expect(response.status).toBe(200);
    expect(response.data).toBe("Simple Authenticated Api Documentation");
  });

  test("returns 200 when routing to a url ending in a path argument", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_VALID_CLIENT,
      TALIS_CDK_AUTH_API_VALID_SECRET,
    );
    const axiosAuthInstance = axios.create({
      headers: { Authorization: `Bearer ${token}` },
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
    });
    const response = await axiosAuthInstance.get("route3/1234");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 3");
  });

  test("returns 403 when routing to a url ending in a path argument", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT,
      TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET,
    );
    try {
      const axiosBadAuthInstance = axios.create({
        headers: { Authorization: `Bearer ${token}` },
        baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
      });
      await axiosBadAuthInstance.get("route3/1234");
      throw Error("Expected a 403 response");
    } catch (err) {
      expect((err as Error).message).toBe(
        "Request failed with status code 403",
      );
    }
  });

  test("returns 200 when routing to a url containing a path argument", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_VALID_CLIENT,
      TALIS_CDK_AUTH_API_VALID_SECRET,
    );
    const axiosAuthInstance = axios.create({
      headers: { Authorization: `Bearer ${token}` },
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
    });
    const response = await axiosAuthInstance.get("route4/1234/route4");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 4");
  });

  test("returns 403 when routing to a url containing a path argument", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT,
      TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET,
    );
    try {
      const axiosBadAuthInstance = axios.create({
        headers: { Authorization: `Bearer ${token}` },
        baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/1/`,
      });
      await axiosBadAuthInstance.get("route4/1234/route4");
      throw Error("Expected a 403 response");
    } catch (err) {
      expect((err as Error).message).toBe(
        "Request failed with status code 403",
      );
    }
  });
});
