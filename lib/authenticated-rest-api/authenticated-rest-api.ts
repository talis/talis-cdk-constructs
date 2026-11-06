import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";

import { aws_apigateway as apigateway } from "aws-cdk-lib";

import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { aws_cloudwatch_actions as cloudwatchActions } from "aws-cdk-lib";
import { aws_logs as awslogs } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambdaNodeJs } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "node:path";

import { AuthenticatedRestApiProps } from "./authenticated-rest-api-props";
import { ResourceProps } from "./resource-props";
import { buildLambdaEnvironment } from "../util/build-lambda-environment";

const DEFAULT_API_LATENCY_THRESHOLD = cdk.Duration.minutes(1);
const DEFAULT_LAMBDA_DURATION_THRESHOLD = cdk.Duration.minutes(1);

export class AuthenticatedRestApi extends Construct {
  readonly restApiId: string;
  readonly domainName: apigateway.DomainName;

  private restApi: apigateway.RestApi;
  private alarmAction: cloudwatch.IAlarmAction;

  constructor(scope: Construct, id: string, props: AuthenticatedRestApiProps) {
    super(scope, id);

    this.domainName = new apigateway.DomainName(this, "domain-name", {
      domainName: props.domainName,
      certificate: acm.Certificate.fromCertificateArn(
        this,
        "cert",
        props.certificateArn,
      ),
    });
    const apiName = `${props.prefix}${props.name}`;
    const apiGatewayProps: apigateway.RestApiProps = {
      restApiName: apiName,
      deployOptions: {
        stageName: props.stageName,
      },
      ...(props.corsDomain && {
        corsPreflight: {
          allowHeaders: ["*"],
          allowMethods: ["ANY"],
          allowCredentials: true,
          allowOrigins: props.corsDomain,
        },
      }),
    };

    this.restApi = new apigateway.RestApi(this, apiName, apiGatewayProps);

    this.restApiId = this.restApi.restApiId;

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
    }

    this.alarmAction = new cloudwatchActions.SnsAction(props.alarmTopic);

    // Methods may require scopes; the authorizer looks them up by the
    // request's "<METHOD> <resource>", e.g. "PUT /items/{itemId}"
    const scopeConfig = collectRequiredScopes(props.resourceProps);

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
        handler: "restApiHandler",

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

    // REQUEST (not TOKEN) so the authorizer sees the method and resource
    // for scope checks, and the X-Request-Id header
    const authorizer = new apigateway.RequestAuthorizer(
      this,
      "lambda-authorizer",
      {
        handler: authLambda,
        identitySources: [apigateway.IdentitySource.header("Authorization")],
        resultsCacheTtl: cdk.Duration.seconds(0),
      },
    );
    // Force a new stage deployment so the TOKEN -> REQUEST authorizer switch
    // takes effect even without @aws-cdk/aws-apigateway:authorizerChangeDeploymentLogicalId
    this.restApi.latestDeployment?.addToLogicalId({ authorizer: "REQUEST" });

    if (props.resourceProps) {
      for (const resourceProp of props.resourceProps) {
        this.addResource(apiName, resourceProp, authorizer);
      }
    }

    // Add a cloudwatch alarm for the latency of the api - this is all routes within the api
    const latencyThreshold = props.apiLatencyAlarmThreshold
      ? props.apiLatencyAlarmThreshold
      : DEFAULT_API_LATENCY_THRESHOLD;
    const metricLatency = this.restApi
      .metricLatency()
      .with({ statistic: "average", period: cdk.Duration.minutes(1) });

    const routeLatencyAlarm = new cloudwatch.Alarm(
      this,
      `${apiName}-latency-alarm`,
      {
        alarmName: `${apiName}-latency-alarm`,
        alarmDescription: `Alarm if latency on api ${apiName} exceeds ${latencyThreshold.toMilliseconds()} milliseconds`,
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

  addResource(
    apiName: string,
    resourceProps: ResourceProps,
    authorizer: apigateway.IAuthorizer,
    parent?: apigateway.Resource,
  ) {
    const actualParent = parent ?? this.restApi.root;

    const resource: apigateway.Resource = actualParent.addResource(
      resourceProps.name,
    );
    for (const method in resourceProps.methods) {
      const integration = new apigateway.LambdaIntegration(
        resourceProps.methods[method].function,
      );
      if (resourceProps.methods[method].isPublic === true) {
        resource.addMethod(method, integration, {
          requestParameters: resourceProps.methods[method].requestParameters,
        });
      } else {
        resource.addMethod(method, integration, {
          authorizer,
        });
      }

      // Add Cloudwatch alarms for this route

      let alarmNamePrefix = `${apiName}-${resourceProps.name}-${method}-`;
      if (parent) {
        alarmNamePrefix = `${apiName}-${parent.path}-${resourceProps.name}-${method}-`;
      }

      // Add an alarm on the duration of the lambda dealing with the HTTP Request
      const durationThreshold = resourceProps.methods[method]
        .lambdaDurationAlarmThreshold
        ? resourceProps.methods[method].lambdaDurationAlarmThreshold
        : DEFAULT_LAMBDA_DURATION_THRESHOLD;
      const durationMetric = resourceProps.methods[method].function
        .metric("Duration")
        .with({ period: cdk.Duration.minutes(1), statistic: "max" });
      const durationAlarm = new cloudwatch.Alarm(
        this,
        `${alarmNamePrefix}duration-alarm`,
        {
          alarmName: `${alarmNamePrefix}duration-alarm`,
          alarmDescription: `Alarm if duration of lambda for route ${alarmNamePrefix} exceeds duration ${durationThreshold.toMilliseconds()} milliseconds`,
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

      const errorsMetric = resourceProps.methods[method].function
        .metric("Errors")
        .with({ period: cdk.Duration.minutes(1), statistic: "sum" });

      const errorsAlarm = new cloudwatch.Alarm(
        this,
        `${alarmNamePrefix}errors-alarm`,
        {
          alarmName: `${alarmNamePrefix}errors-alarm`,
          alarmDescription: `Alarm if errors on api ${alarmNamePrefix}`,
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

    resourceProps.nestedResources?.map((nestedResource) =>
      this.addResource(apiName, nestedResource, authorizer, resource),
    );
  }
}

function collectRequiredScopes(
  resources: ResourceProps[] | undefined,
  parentPath = "",
  scopes: Record<string, string> = {},
): Record<string, string> {
  for (const resource of resources ?? []) {
    const path = `${parentPath}/${resource.name}`;
    for (const [method, methodProps] of Object.entries(
      resource.methods ?? {},
    )) {
      if (methodProps.requiredScope) {
        scopes[`${method.toUpperCase()} ${path}`] = methodProps.requiredScope;
      }
    }
    collectRequiredScopes(resource.nestedResources, path, scopes);
  }
  return scopes;
}
