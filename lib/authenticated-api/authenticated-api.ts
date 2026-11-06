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
import * as path from "path";

import { AuthenticatedApiProps } from "./authenticated-api-props";
import { RouteUrlProps } from "./route-url-props";
import { buildLambdaEnvironment } from "../util/build-lambda-environment";

const DEFAULT_API_LATENCY_THRESHOLD = cdk.Duration.minutes(1);
const DEFAULT_LAMBDA_DURATION_THRESHOLD = cdk.Duration.minutes(1);

export class AuthenticatedApi extends Construct {
  readonly apiId: string;
  readonly httpApiId: string;
  readonly domainName: apigatewayv2.DomainName;

  private httpApi: apigatewayv2.HttpApi;
  private authorizer: apigatewayv2.IHttpRouteAuthorizer;
  private alarmAction: cloudwatch.IAlarmAction;

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

    this.alarmAction = new cloudwatchActions.SnsAction(props.alarmTopic);

    // Routes may contain required scopes. These scopes need to be in the config
    // of the authorization lambda. Create this config ahead of creating the authorization lambda
    const scopeConfig: { [k: string]: string } = {};
    if (props.lambdaRoutes) {
      for (const routeProps of props.lambdaRoutes) {
        if (routeProps.requiredScope) {
          scopeConfig[routeProps.path] = routeProps.requiredScope;
        }
      }
    }

    const authLambdaTimeout = cdk.Duration.minutes(2);

    const libPath = path.resolve(__dirname, "../../");

    // Auth Lambda
    const authLambda = new lambdaNodeJs.NodejsFunction(
      this,
      `${apiName}-authoriser`,
      {
        functionName: `${apiName}-authoriser`,

        depsLockFilePath: path.resolve(libPath, "src/npm-shrinkwrap.json"),
        entry: path.resolve(libPath, "src/lambda/api/authorizer.ts"),
        handler: "validateToken",

        bundling: {
          commandHooks: {
            beforeBundling: () => {
              return ["npm ci"];
            },
            beforeInstall: () => [],
            afterBundling: () => [],
          },
          externalModules: [
            "aws-sdk",

            // hiredis is pulled in as a dependency from talis-node
            // It has dependencies on gcc g++ and python to compile code during an npm install
            // The redis cache is an optional parameter to the persona client in talis-node
            // which we do not use in serverless projects. Remove this from the bundle created
            // by esbuild to remove unnecessary issues with gcc/g++/python/node which have
            // no impact as we do not use redis here.
            "hiredis",
          ],
        },

        environment: buildLambdaEnvironment({
          environment: {
            PERSONA_CLIENT_NAME: `${apiName}-authoriser`,
            PERSONA_HOST: props.persona.host,
            PERSONA_SCHEME: props.persona.scheme,
            PERSONA_PORT: props.persona.port,
            PERSONA_OAUTH_ROUTE: props.persona.oauth_route,
            SCOPE_CONFIG: JSON.stringify(scopeConfig),
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

        if (routeProps.isPublic === true) {
          this.httpApi.addRoutes({
            path: routeProps.path,
            methods: [routeProps.method],
            integration,
          });
        } else {
          this.httpApi.addRoutes({
            path: routeProps.path,
            methods: [routeProps.method],
            integration,
            authorizer: this.authorizer,
          });
        }

        // Add Cloudwatch alarms for this route

        // Add an alarm on the duration of the lambda dealing with the HTTP Request
        const durationThreshold = routeProps.lamdaDurationAlarmThreshold
          ? routeProps.lamdaDurationAlarmThreshold
          : DEFAULT_LAMBDA_DURATION_THRESHOLD;
        const durationMetric = routeProps.lambda
          .metric("Duration")
          .with({ period: cdk.Duration.minutes(1), statistic: "max" });
        const durationAlarm = new cloudwatch.Alarm(
          this,
          `${apiName}-${routeProps.name}-duration-alarm`,
          {
            alarmName: `${apiName}-${routeProps.name}-duration-alarm`,
            alarmDescription: `Alarm if duration of lambda for route ${
              props.prefix
            }${props.name}-${
              routeProps.name
            } exceeds duration ${durationThreshold.toMilliseconds()} milliseconds`,
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
        durationAlarm.addAlarmAction(this.alarmAction);
        durationAlarm.addOkAction(this.alarmAction);

        const errorsMetric = routeProps.lambda
          .metric("Errors")
          .with({ period: cdk.Duration.minutes(1), statistic: "sum" });

        const errorsAlarm = new cloudwatch.Alarm(
          this,
          `${apiName}-${routeProps.name}-errors-alarm`,
          {
            alarmName: `${apiName}-${routeProps.name}-errors-alarm`,
            alarmDescription: `Alarm if errors on api ${apiName}-${routeProps.name}`,
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
        errorsAlarm.addAlarmAction(this.alarmAction);
        errorsAlarm.addOkAction(this.alarmAction);
      }
    }

    // Add a cloudwatch alarm for the latency of the api - this is all routes within the api
    const latencyThreshold = props.apiLatencyAlarmThreshold
      ? props.apiLatencyAlarmThreshold
      : DEFAULT_API_LATENCY_THRESHOLD;
    const metricLatency = this.httpApi
      .metricLatency()
      .with({ statistic: "average", period: cdk.Duration.minutes(1) });

    const routeLatencyAlarm = new cloudwatch.Alarm(
      this,
      `${apiName}-latency-alarm`,
      {
        alarmName: `${apiName}-latency-alarm`,
        alarmDescription: `Alarm if latency on api ${props.prefix}${
          props.name
        } exceeds ${latencyThreshold.toMilliseconds()} milliseconds`,
        actionsEnabled: true,
        metric: metricLatency,
        evaluationPeriods: 1,
        threshold: latencyThreshold.toMilliseconds(),
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    );
    routeLatencyAlarm.addAlarmAction(this.alarmAction);
    routeLatencyAlarm.addOkAction(this.alarmAction);
  }

  addUrlRoute(routeProps: RouteUrlProps) {
    this.httpApi.addRoutes({
      path: routeProps.path,
      methods: [routeProps.method],
      integration: new integrations.HttpUrlIntegration(
        routeProps.name,
        routeProps.baseUrl,
        {
          method: routeProps.method,
        },
      ),
    });
  }
}
