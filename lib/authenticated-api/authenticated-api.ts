import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { aws_cloudwatch_actions as cloudwatchActions } from "aws-cdk-lib";
import { aws_logs as awslogs } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambdaNodeJs } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "node:path";

import { AuthenticatedApiProps } from "./authenticated-api-props";
import { RouteLambdaProps } from "./route-lambda-props";
import { RouteUrlProps } from "./route-url-props";
import { buildLambdaEnvironment } from "../util/build-lambda-environment";
import { resolvePersonaOrigin } from "../util/persona-origin";
import { TalisAlarm, TalisAlarmProps } from "../talis-alarm";

const DEFAULT_API_LATENCY_THRESHOLD = cdk.Duration.minutes(1);
const DEFAULT_LAMBDA_DURATION_THRESHOLD = cdk.Duration.minutes(1);

export class AuthenticatedApi extends Construct {
  readonly apiId: string;
  readonly httpApiId: string;
  readonly domainName: apigatewayv2.DomainName;

  private httpApi: apigatewayv2.HttpApi;
  private authorizer: apigatewayv2.IHttpRouteAuthorizer;
  // Required scope per "<METHOD> <path>", the authorizer event's routeKey
  private readonly scopeConfig: Record<string, string> = {};
  private alarmActions: cloudwatch.IAlarmAction[];
  private paging: Pick<TalisAlarmProps, "onCallTeam" | "runbookUrl">;

  constructor(scope: Construct, id: string, props: AuthenticatedApiProps) {
    super(scope, id);

    if (
      (props.domainName && !props.certificateArn) ||
      (!props.domainName && props.certificateArn)
    ) {
      cdk.Annotations.of(scope).addError(
        `To use a custom domain name both certificateArn and domainName must be specified`,
      );
    }
    this.domainName = new apigatewayv2.DomainName(this, "domain-name", {
      domainName: props.domainName,
      certificate: acm.Certificate.fromCertificateArn(
        this,
        "cert",
        props.certificateArn,
      ),
    });
    const apiName = `${props.prefix}${props.name}`;
    const apiGatewayProps: apigatewayv2.HttpApiProps = {
      apiName: apiName,
      defaultDomainMapping: { domainName: this.domainName },
      ...(props.corsDomain && {
        corsPreflight: {
          allowHeaders: ["*"],
          allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
          allowCredentials: props.corsAllowCredentials ?? true,
          allowOrigins: props.corsDomain,
        },
      }),
    };

    this.httpApi = new apigatewayv2.HttpApi(this, apiName, apiGatewayProps);

    this.apiId = this.httpApi.apiId;
    this.httpApiId = this.httpApi.httpApiId;

    if (props.logging?.enabled) {
      const logGroup = new awslogs.LogGroup(this, "apiGatewayLogs", {
        // CloudWatch Logs automatically enables the /aws/vendedlogs/* prefix
        // in the resource policy, so we use it to avoid adding each log
        // group to the policy, which has a limit of 5120 characters.
        logGroupName: `/aws/vendedlogs/${apiName}-accessLog`,
        retention: props.logging.retention,
      });

      new cdk.CfnOutput(this, "apiGatewayLogGroup", {
        exportName: `${apiName}-accessLogGroup`,
        value: logGroup.logGroupName,
      });

      // Setting the accessLogSettings directly on the created HttpApi is
      // not implemented in CDK. Since we only use a single API stage,
      // we can grab the default stage, and enable logging there.
      // See https://github.com/aws/aws-cdk/issues/11100
      const defaultStage = this.httpApi.defaultStage?.node
        .defaultChild as apigatewayv2.CfnStage;

      defaultStage.accessLogSettings = {
        destinationArn: logGroup.logGroupArn,
        format:
          props.logging.format ??
          JSON.stringify({
            requestId: "$context.requestId",
            protocol: "$context.protocol",
            method: "$context.httpMethod",
            path: "$context.path",
            status: "$context.status",
            domainName: "$context.domainName",
            requestTime: "$context.requestTime",
            responseLength: "$context.responseLength",
            userAgent: "$context.identity.userAgent",
            sourceIp: "$context.identity.sourceIp",
            clientContext: {
              clientId: "$context.authorizer.clientId",
            },
          }),
      };
    }

    new cdk.CfnOutput(this, "apiGatewayEndpoint", {
      exportName: `${apiName}-endpoint`,
      value: this.httpApi.apiEndpoint,
    });

    this.alarmActions = props.alarmTopic
      ? [new cloudwatchActions.SnsAction(props.alarmTopic)]
      : [];
    this.paging = {
      onCallTeam: props.onCallTeam,
      runbookUrl: props.runbookUrl,
    };

    const authLambdaTimeout = cdk.Duration.minutes(2);

    const libPath = path.resolve(__dirname, "../../");

    // Auth Lambda
    const authLambda = new lambdaNodeJs.NodejsFunction(
      this,
      `${apiName}-authoriser`,
      {
        functionName: `${apiName}-authoriser`,

        depsLockFilePath: path.resolve(libPath, "src/npm-shrinkwrap.json"),
        entry: path.resolve(libPath, "src/lambda/authorizers.ts"),
        handler: "httpApiHandler",

        environment: buildLambdaEnvironment({
          environment: {
            PERSONA_CLIENT_NAME: `${apiName}-authoriser`,
            PERSONA_ORIGIN: resolvePersonaOrigin(props),
            // Lazy: addUrlRoute can add scoped routes after construction
            SCOPE_CONFIG: cdk.Lazy.string({
              produce: () => JSON.stringify(this.scopeConfig),
            }),
          },
          timeout: authLambdaTimeout,
        }),

        awsSdkConnectionReuse: true,
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: authLambdaTimeout,
        securityGroups: props.securityGroups,
        vpc: props.vpc,
        vpcSubnets: props.vpcSubnets,
      },
    );

    this.authorizer = new authorizers.HttpLambdaAuthorizer(
      "lambda-authorizer",
      authLambda,
      {
        authorizerName: `${apiName}-http-lambda-authoriser`,
        // Decisions depend on the route's required scope, so cache per route
        identitySource: ["$request.header.Authorization", "$context.routeKey"],
        responseTypes: [authorizers.HttpLambdaResponseType.SIMPLE], // Define if returns simple and/or iam response
      },
    );

    if (props.urlRoutes) {
      for (const routeProps of props.urlRoutes) {
        this.addUrlRoute(routeProps);
      }
    }

    if (props.lambdaRoutes) {
      for (const routeProps of props.lambdaRoutes) {
        const integration = new integrations.HttpLambdaIntegration(
          "http-lambda-integration",
          routeProps.lambda,
        );

        this.addRoute(routeProps, integration);

        // Add Cloudwatch alarms for this route

        // Add an alarm on the duration of the lambda dealing with the HTTP Request
        const durationThreshold = routeProps.lamdaDurationAlarmThreshold
          ? routeProps.lamdaDurationAlarmThreshold
          : DEFAULT_LAMBDA_DURATION_THRESHOLD;
        const durationMetric = routeProps.lambda
          .metric("Duration")
          .with({ period: cdk.Duration.minutes(1), statistic: "max" });
        const durationAlarm = new TalisAlarm(
          this,
          `${apiName}-${routeProps.name}-duration-alarm`,
          {
            ...this.paging,
            alarmName: `${apiName}-${routeProps.name}-duration-alarm`,
            alarmDescription: `The Lambda for ${routeProps.method} ${routeProps.path} of API ${apiName} took ${durationThreshold.toHumanString()} or longer to handle a request.`,
            actionsEnabled: true,
            metric: durationMetric,
            evaluationPeriods: 1,
            threshold: durationThreshold.toMilliseconds(),
            comparisonOperator:
              cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            // Set treatMissingData to IGNORE
            // Stops alarms with minimal data having false alarms when they transition to this state
            treatMissingData: cloudwatch.TreatMissingData.IGNORE,
          },
        );
        durationAlarm.addAlarmAction(...this.alarmActions);
        durationAlarm.addOkAction(...this.alarmActions);

        const errorsMetric = routeProps.lambda
          .metric("Errors")
          .with({ period: cdk.Duration.minutes(1), statistic: "sum" });

        const errorsAlarm = new TalisAlarm(
          this,
          `${apiName}-${routeProps.name}-errors-alarm`,
          {
            ...this.paging,
            alarmName: `${apiName}-${routeProps.name}-errors-alarm`,
            alarmDescription: `The Lambda for ${routeProps.method} ${routeProps.path} of API ${apiName} failed to handle a request.`,
            actionsEnabled: true,
            metric: errorsMetric,
            evaluationPeriods: 1,
            threshold: 1,
            comparisonOperator:
              cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            // Set treatMissingData to IGNORE
            // Stops alarms with minimal data having false alarms when they transition to this state
            treatMissingData: cloudwatch.TreatMissingData.IGNORE,
          },
        );
        errorsAlarm.addAlarmAction(...this.alarmActions);
        errorsAlarm.addOkAction(...this.alarmActions);
      }
    }

    // Add a cloudwatch alarm for the latency of the api - this is all routes within the api
    const latencyThreshold = props.apiLatencyAlarmThreshold
      ? props.apiLatencyAlarmThreshold
      : DEFAULT_API_LATENCY_THRESHOLD;
    const metricLatency = this.httpApi
      .metricLatency()
      .with({ statistic: "average", period: cdk.Duration.minutes(1) });

    const routeLatencyAlarm = new TalisAlarm(this, `${apiName}-latency-alarm`, {
      ...this.paging,
      alarmName: `${apiName}-latency-alarm`,
      alarmDescription: `The average latency of API ${apiName} was ${latencyThreshold.toHumanString()} or more over 1 minute.`,
      actionsEnabled: true,
      metric: metricLatency,
      evaluationPeriods: 1,
      threshold: latencyThreshold.toMilliseconds(),
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // Set treatMissingData to IGNORE
      // Stops alarms with minimal data having false alarms when they transition to this state
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    });
    routeLatencyAlarm.addAlarmAction(...this.alarmActions);
    routeLatencyAlarm.addOkAction(...this.alarmActions);
  }

  addUrlRoute(routeProps: RouteUrlProps) {
    this.addRoute(
      routeProps,
      new integrations.HttpUrlIntegration(routeProps.name, routeProps.baseUrl, {
        method: routeProps.method,
      }),
    );
  }

  private addRoute(
    routeProps: RouteLambdaProps | RouteUrlProps,
    integration: apigatewayv2.HttpRouteIntegration,
  ) {
    this.httpApi.addRoutes({
      path: routeProps.path,
      methods: [routeProps.method],
      integration,
      authorizer: routeProps.isPublic === true ? undefined : this.authorizer,
    });
    if (routeProps.requiredScope) {
      this.scopeConfig[`${routeProps.method} ${routeProps.path}`] =
        routeProps.requiredScope;
    }
  }
}
