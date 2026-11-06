import * as cdk from "aws-cdk-lib";
import { aws_lambda as lambda, aws_sns as sns } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as path from "node:path";

import {
  AuthenticatedRestApi,
  AuthenticatedRestApiFunction,
} from "../../../lib";

describe("AuthenticatedRestApi", () => {
  let template: Template;

  beforeAll(() => {
    const stack = new cdk.Stack(new cdk.App(), "TestStack");
    const handler = new AuthenticatedRestApiFunction(stack, "handler", {
      name: "test-rest-handler",
      entry: path.resolve(__dirname, "../authenticated-api/routes/route1.js"),
      handler: "route",
      timeout: cdk.Duration.seconds(30),
      runtime: lambda.Runtime.NODEJS_22_X,
    });
    const method = {
      function: handler,
      lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
    };

    new AuthenticatedRestApi(stack, "TestRestApi", {
      prefix: "test-",
      name: "test-rest-api",
      description: "Test REST API",
      stageName: "development",
      alarmTopic: new sns.Topic(stack, "Alarms"),
      domainName: "test-rest-api.talis.com",
      certificateArn:
        "arn:aws:acm:eu-west-1:302477901552:certificate/564e2081-81f3-4250-a2a9-d2b88916483a",
      persona: {
        host: "staging-users.talis.com",
        scheme: "https",
        port: "443",
        oauth_route: "/oauth/tokens/",
      },
      resourceProps: [
        {
          name: "items",
          methods: {
            GET: { ...method, isPublic: true },
            POST: { ...method, requiredScope: "items:write" },
          },
          nestedResources: [
            {
              name: "{itemId}",
              methods: {
                PUT: { ...method, requiredScope: "items:write,su@items" },
                DELETE: method,
              },
            },
          ],
        },
      ],
    });
    template = Template.fromStack(stack);
  });

  test("uses an uncached REQUEST authorizer on the Authorization header", () => {
    template.hasResourceProperties("AWS::ApiGateway::Authorizer", {
      Type: "REQUEST",
      IdentitySource: "method.request.header.Authorization",
      AuthorizerResultTtlInSeconds: 0,
    });
  });

  test("passes the Persona origin, built from the persona props, to the authorizer", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.restApiHandler",
      Environment: {
        Variables: {
          PERSONA_ORIGIN: "https://staging-users.talis.com:443",
          PERSONA_OAUTH_ROUTE: Match.absent(),
        },
      },
    });
  });

  test("passes required scopes per method and resource to the authorizer", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.restApiHandler",
      Environment: {
        Variables: {
          SCOPE_CONFIG: JSON.stringify({
            "POST /items": "items:write",
            "PUT /items/{itemId}": "items:write,su@items",
          }),
        },
      },
    });
  });
});
