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
      onCallTeam: "talis-platform",
      runbookUrl: "https://example.com/runbooks/api",
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
              nestedResources: [
                {
                  name: "tags",
                  methods: {
                    ANY: { ...method, requiredScope: "tags:write" },
                    // Unscoped: must not inherit the ANY scope
                    GET: method,
                  },
                  nestedResources: [
                    {
                      name: "{tagId}",
                      // Lowercase: API Gateway and the scope keys use uppercase
                      methods: {
                        get: { ...method, requiredScope: "tags:read" },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          // No methods of its own; a same-named "items" further down
          name: "users",
          nestedResources: [
            {
              name: "{userId}",
              nestedResources: [
                {
                  name: "items",
                  methods: { GET: { ...method, requiredScope: "users:read" } },
                },
              ],
            },
          ],
        },
      ],
    });
    template = Template.fromStack(stack);
  });

  test("tags the method alarms for paging, with the method's Lambda", () => {
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: Match.stringLikeRegexp("items-POST-duration-alarm$"),
      Tags: [
        {
          Key: "lambda_function",
          Value: { Ref: Match.stringLikeRegexp("^handler") },
        },
        { Key: "oncall_team", Value: "talis-platform" },
        { Key: "runbook_url", Value: "https://example.com/runbooks/api" },
      ],
      ActionConfiguration: { AlarmTagsPropagation: { Enabled: true } },
    });
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
            "ANY /items/{itemId}/tags": "tags:write",
            "GET /items/{itemId}/tags": "",
            "GET /items/{itemId}/tags/{tagId}": "tags:read",
            "GET /users/{userId}/items": "users:read",
          }),
        },
      },
    });
  });

  // Scope keys and resources are built by separate walks over resourceProps
  test("keys every scope by an authorized method the API actually has", () => {
    const resources = template.findResources("AWS::ApiGateway::Resource");
    const pathOf = (id: string): string => {
      const { PathPart, ParentId } = resources[id].Properties;
      // Children of the root reference it with Fn::GetAtt, not Ref
      return ParentId.Ref
        ? `${pathOf(ParentId.Ref)}/${PathPart}`
        : `/${PathPart}`;
    };
    const authorizedMethods = Object.values(
      template.findResources("AWS::ApiGateway::Method", {
        Properties: { AuthorizationType: "CUSTOM" },
      }),
    ).map(({ Properties: p }) => `${p.HttpMethod} ${pathOf(p.ResourceId.Ref)}`);
    const [authorizer] = Object.values(
      template.findResources("AWS::Lambda::Function", {
        Properties: { Handler: "index.restApiHandler" },
      }),
    );
    const scopeKeys = Object.keys(
      JSON.parse(authorizer.Properties.Environment.Variables.SCOPE_CONFIG),
    );

    expect(scopeKeys).toHaveLength(6);
    expect(authorizedMethods).toEqual(expect.arrayContaining(scopeKeys));
  });
});
