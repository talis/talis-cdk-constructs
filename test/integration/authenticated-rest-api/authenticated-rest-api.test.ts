import axios from "axios";
import { APIGateway } from "aws-sdk";

const api = new APIGateway();

const TALIS_CDK_AUTH_API_VALID_CLIENT =
  process.env.TALIS_CDK_AUTH_API_VALID_CLIENT ?? "";
const TALIS_CDK_AUTH_API_VALID_SECRET =
  process.env.TALIS_CDK_AUTH_API_VALID_SECRET ?? "";

describe("AuthenticatedRestApi", () => {
  // Increase the timeout We are making http calls which might have to spin up a cold lambda
  vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

  let apiGatewayId: string;

  async function findApiGatewayId(
    position: string | undefined = undefined,
  ): Promise<string> {
    console.log(
      `Searching for API: ${process.env.AWS_PREFIX}simple-authenticated-rest-api`,
    );
    const response = await api.getRestApis({ position: position }).promise();

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

  beforeAll(async () => {
    apiGatewayId = await findApiGatewayId();
  });

  test("returns 200 for unauthenticated route", async () => {
    const axiosNoAuthInstance = axios.create({
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development`,
    });
    const response = await axiosNoAuthInstance.get("simple-resource");
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 1");
  });

  test("returns 401 for authenticated route", async () => {
    const axiosNoAuthInstance = axios.create({
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development`,
    });
    try {
      await axiosNoAuthInstance.post("simple-resource");
      expect.unreachable("Expected 401");
    } catch (err) {
      expect((err as Error).message).toBe(
        "Request failed with status code 401",
      );
    }
  });

  test("returns 200 for authenticated route when using token", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_VALID_CLIENT,
      TALIS_CDK_AUTH_API_VALID_SECRET,
    );
    const axiosAuthInstance = axios.create({
      headers: { Authorization: `Bearer ${token}` },
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development`,
    });
    const response = await axiosAuthInstance.post("simple-resource", {});
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
  });

  test("returns 200 for nested route", async () => {
    const token = await getOAuthToken(
      TALIS_CDK_AUTH_API_VALID_CLIENT,
      TALIS_CDK_AUTH_API_VALID_SECRET,
    );
    const axiosAuthInstance = axios.create({
      headers: { Authorization: `Bearer ${token}` },
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development`,
    });
    const response = await axiosAuthInstance.put("simple-resource/id1", {});
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 2");
  });

  test("returns 200 for a more deeply nested route", async () => {
    const axiosNoAuthInstance = axios.create({
      baseURL: `https://${apiGatewayId}.execute-api.eu-west-1.amazonaws.com/development`,
    });
    const response = await axiosNoAuthInstance.get(
      "simple-resource/id1/child-resource/id2",
      {},
    );
    expect(response.status).toBe(200);
    expect(response.data).toBe("route 4");
  });
});
