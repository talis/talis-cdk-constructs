import * as cdk from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import * as path from "node:path";

import { AuthenticatedApi, AuthenticatedApiFunction } from "../../../lib";

describe("AuthenticatedApi", () => {
  describe("with lambda routes", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });
      const vpc = new ec2.Vpc(stack, "TheVPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      });

      // Create the lambda's to be passed into the AuthenticatedApi construct
      const route1Handler = new AuthenticatedApiFunction(
        stack,
        `test-simple-authenticated-api-route1-handler`,
        {
          name: `test-route1-handler`,
          entry: `${path.resolve(__dirname)}/routes/route1.js`,
          environment: {},
          handler: "route",
          runtime: lambda.Runtime.NODEJS_22_X,
          timeout: cdk.Duration.seconds(30),
          securityGroups: [],
          vpc: vpc,
        },
      );

      const route2Handler = new AuthenticatedApiFunction(
        stack,
        `test-simple-authenticated-api-route2-handler`,
        {
          name: `test-route2-handler`,
          environment: {},
          timeout: cdk.Duration.seconds(30),
          securityGroups: [],
          vpc: vpc,

          // NodejsFunction props
          entry: path.resolve(__dirname, "routes/route2.js"),
          handler: "route",
          projectRoot: path.resolve(__dirname, "../../.."),
          depsLockFilePath: "package-lock.json",
          runtime: lambda.Runtime.NODEJS_20_X,
          awsSdkConnectionReuse: false,
          bundling: {
            minify: true,
          },
        },
      );

      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        prefix: `test-`,
        name: "MyTestAuthenticatedApi",
        description: "A simple example API",
        stageName: "development", // This should be development / staging / production as appropriate
        alarmTopic,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        domainName: `test-simple-authenticated-api.talis.com`,
        certificateArn:
          "arn:aws:acm:eu-west-1:302477901552:certificate/564e2081-81f3-4250-a2a9-d2b88916483a",
        corsDomain: [
          "http://localhost:4200",
          `https://test-simple-authenticated-api.talis.com`,
        ],

        persona: {
          host: "staging-users.talis.com",
          scheme: "https",
          port: "443",
          oauth_route: "/oauth/tokens/",
        },

        lambdaRoutes: [
          {
            name: "route1",
            path: "/1/test-route-1",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route1Handler,
            requiredScope: "test:read",
          },
          {
            name: "route2",
            path: "/1/test-route-2",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route2Handler,
            isPublic: true,
          },
        ],
      });
    });

    test("provisions an api", () => {
      Template.fromStack(stack).resourceCountIs("AWS::ApiGatewayV2::Api", 1);

      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Api",
        {
          Name: "test-MyTestAuthenticatedApi",
          ProtocolType: "HTTP",
          CorsConfiguration: {
            AllowCredentials: true,
            AllowHeaders: ["*"],
            AllowMethods: ["*"],
            AllowOrigins: [
              "http://localhost:4200",
              `https://test-simple-authenticated-api.talis.com`,
            ],
          },
        },
      );
    });

    test("provisions routes", () => {
      Template.fromStack(stack).resourceCountIs("AWS::ApiGatewayV2::Route", 2);

      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Route",
        {
          RouteKey: "GET /1/test-route-1",
          AuthorizationType: "CUSTOM",
        },
      );
      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Route",
        {
          RouteKey: "GET /1/test-route-2",
          AuthorizationType: "NONE",
        },
      );
    });

    test("provisions authorizer lambda", () => {
      Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 3);

      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "test-MyTestAuthenticatedApi-authoriser",
        Timeout: 120,
        Handler: "index.httpApiHandler",
        Runtime: "nodejs24.x",
        Environment: {
          Variables: {
            PERSONA_CLIENT_NAME: "test-MyTestAuthenticatedApi-authoriser",
            PERSONA_HOST: "staging-users.talis.com",
            PERSONA_SCHEME: "https",
            PERSONA_PORT: "443",
            PERSONA_OAUTH_ROUTE: "/oauth/tokens/",
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            LAMBDA_EXECUTION_TIMEOUT: "120",
            SCOPE_CONFIG: JSON.stringify({
              "GET /1/test-route-1": "test:read",
            }),
          },
        },
      });
    });

    test("caches authorizer results per route", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Authorizer",
        {
          AuthorizerType: "REQUEST",
          IdentitySource: [
            "$request.header.Authorization",
            "$context.routeKey",
          ],
        },
      );
    });

    test("provisions lambdas for the routes", () => {
      Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 3);
      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "test-route1-handler",
        Timeout: 30,
        Handler: "index.route",
        Runtime: "nodejs22.x",
        Environment: {
          Variables: {
            LAMBDA_EXECUTION_TIMEOUT: "30",
          },
        },
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "test-route2-handler",
        Timeout: 30,
        Handler: "index.route",
        Runtime: "nodejs20.x",
        Environment: {
          Variables: {
            LAMBDA_EXECUTION_TIMEOUT: "30",
          },
        },
      });
    });

    test("provisions five alarms", () => {
      Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 5);
    });

    test("provisions alarm to warn of latency on the api", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        {
          AlarmName: "test-MyTestAuthenticatedApi-latency-alarm",
          AlarmDescription:
            "Alarm if latency on api test-MyTestAuthenticatedApi exceeds 60000 milliseconds",
          Namespace: "AWS/ApiGateway",
          MetricName: "Latency",
          Dimensions: [
            {
              Name: "ApiId",
              Value: {
                Ref: "MyTestAuthenticatedApitestMyTestAuthenticatedApi09BBF2A7",
              },
            },
          ],
          Period: 60,
          Statistic: "Average",
          Threshold: 60000,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          TreatMissingData: "ignore",
          OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
        },
      );
    });

    test("provisions alarms on duration of lambda's", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        {
          AlarmName: "test-MyTestAuthenticatedApi-route1-duration-alarm",
          AlarmDescription:
            "Alarm if duration of lambda for route test-MyTestAuthenticatedApi-route1 exceeds duration 60000 milliseconds",
          Namespace: "AWS/Lambda",
          MetricName: "Duration",
          Dimensions: [
            {
              Name: "FunctionName",
              Value: {
                Ref: "testsimpleauthenticatedapiroute1handler9C009052",
              },
            },
          ],
          Period: 60,
          Statistic: "Maximum",
          Threshold: 60000,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          TreatMissingData: "ignore",
          OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
        },
      );

      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        {
          AlarmName: "test-MyTestAuthenticatedApi-route2-duration-alarm",
          AlarmDescription:
            "Alarm if duration of lambda for route test-MyTestAuthenticatedApi-route2 exceeds duration 60000 milliseconds",
          Namespace: "AWS/Lambda",
          MetricName: "Duration",
          Dimensions: [
            {
              Name: "FunctionName",
              Value: {
                Ref: "testsimpleauthenticatedapiroute2handlerA618DED6",
              },
            },
          ],
          Period: 60,
          Statistic: "Maximum",
          Threshold: 60000,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          TreatMissingData: "ignore",
          OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
        },
      );
    });

    test("provisions alarms on errors of lambda's", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        {
          AlarmName: "test-MyTestAuthenticatedApi-route1-errors-alarm",
          AlarmDescription:
            "Alarm if errors on api test-MyTestAuthenticatedApi-route1",
          Namespace: "AWS/Lambda",
          MetricName: "Errors",
          Dimensions: [
            {
              Name: "FunctionName",
              Value: {
                Ref: "testsimpleauthenticatedapiroute1handler9C009052",
              },
            },
          ],
          Period: 60,
          Statistic: "Sum",
          Threshold: 1,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          TreatMissingData: "ignore",
          OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
        },
      );

      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudWatch::Alarm",
        {
          AlarmName: "test-MyTestAuthenticatedApi-route2-errors-alarm",
          AlarmDescription:
            "Alarm if errors on api test-MyTestAuthenticatedApi-route2",
          Namespace: "AWS/Lambda",
          MetricName: "Errors",
          Dimensions: [
            {
              Name: "FunctionName",
              Value: {
                Ref: "testsimpleauthenticatedapiroute2handlerA618DED6",
              },
            },
          ],
          Period: 60,
          Statistic: "Sum",
          Threshold: 1,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          TreatMissingData: "ignore",
          OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
        },
      );
    });
  });

  describe("with url routes", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });
      const vpc = new ec2.Vpc(stack, "TheVPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      });

      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        prefix: `test-`,
        name: "MyTestAuthenticatedApiWithUrlRoutes",
        description: "A simple example API",
        stageName: "development", // This should be development / staging / production as appropriate
        alarmTopic,
        vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        domainName: `test-simple-authenticated-api.talis.com`,
        certificateArn:
          "arn:aws:acm:eu-west-1:302477901552:certificate/564e2081-81f3-4250-a2a9-d2b88916483a",
        corsDomain: [
          "http://localhost:4200",
          `https://test-simple-authenticated-api.talis.com`,
        ],

        persona: {
          host: "staging-users.talis.com",
          scheme: "https",
          port: "443",
          oauth_route: "/oauth/tokens/",
        },

        urlRoutes: [
          {
            name: "route1",
            baseUrl: "https://www.example.com",
            path: "/api/index.html",
            method: apigatewayv2.HttpMethod.GET,
          },
          {
            name: "route2",
            baseUrl: "https://www.example.com",
            path: "/docs/index.html",
            method: apigatewayv2.HttpMethod.GET,
          },
        ],
      });
    });

    test("provisions routes", () => {
      Template.fromStack(stack).resourceCountIs("AWS::ApiGatewayV2::Route", 2);

      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Route",
        {
          RouteKey: "GET /api/index.html",
          AuthorizationType: "NONE",
        },
      );
      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Route",
        {
          RouteKey: "GET /docs/index.html",
          AuthorizationType: "NONE",
        },
      );
    });
  });

  describe("with access logs", () => {
    let stack: cdk.Stack;
    let alarmTopic: sns.Topic;
    const apiProps = {
      prefix: `test-`,
      name: "MyTestAuthenticatedApiWithAccessLogs",
      description: "A simple example API",
      stageName: "development",
      domainName: `test-simple-authenticated-api.talis.com`,
      certificateArn:
        "arn:aws:acm:eu-west-1:987654321000:certificate/12345678-abcd-1234-abcd-123456789012",
      persona: {
        host: "staging-users.talis.com",
        scheme: "https",
        port: "443",
        oauth_route: "/oauth/tokens/",
      },
    };

    beforeEach(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack");
      alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });
    });

    test("logging disabled by default", () => {
      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        ...apiProps,
        alarmTopic,
      });

      Template.fromStack(stack).resourceCountIs("AWS::Logs::LogGroup", 0);
    });

    test("logging can be enabled", () => {
      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        ...apiProps,
        alarmTopic,
        logging: {
          enabled: true,
        },
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName:
          "/aws/vendedlogs/test-MyTestAuthenticatedApiWithAccessLogs-accessLog",
        RetentionInDays: 731,
      });

      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Stage",
        {
          StageName: "$default",
          AccessLogSettings: {
            DestinationArn: {
              "Fn::GetAtt": [
                Match.stringLikeRegexp("MyTestAuthenticatedApi*"),
                "Arn",
              ],
            },
            Format: Match.stringLikeRegexp(
              '{\\"requestId":\\"\\$context.requestId\\",*',
            ),
          },
        },
      );
    });

    test("logging can be enabled with custom log format", () => {
      const apacheLikeFormat = `$context.identity.sourceIp - - [$context.requestTime] "$context.routeKey $context.protocol" $context.status $context.responseLength $context.requestId`;

      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        ...apiProps,
        alarmTopic,
        logging: {
          enabled: true,
          format: apacheLikeFormat,
        },
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName:
          "/aws/vendedlogs/test-MyTestAuthenticatedApiWithAccessLogs-accessLog",
        RetentionInDays: 731,
      });

      Template.fromStack(stack).hasResourceProperties(
        "AWS::ApiGatewayV2::Stage",
        {
          StageName: "$default",
          AccessLogSettings: {
            DestinationArn: {
              "Fn::GetAtt": [
                Match.stringLikeRegexp("MyTestAuthenticatedApi*"),
                "Arn",
              ],
            },
            Format: apacheLikeFormat,
          },
        },
      );
    });

    test("logging can be enabled with custom retention period", () => {
      new AuthenticatedApi(stack, "MyTestAuthenticatedApi", {
        ...apiProps,
        alarmTopic,
        logging: {
          enabled: true,
          retention: 90,
        },
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName:
          "/aws/vendedlogs/test-MyTestAuthenticatedApiWithAccessLogs-accessLog",
        RetentionInDays: 90,
      });
    });
  });
});
