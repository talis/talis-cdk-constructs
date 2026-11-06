import * as cdk from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { Construct } from "constructs";

import {
  AuthenticatedRestApi,
  AuthenticatedRestApiFunction,
} from "../../../lib";

export const STAGING_TALIS_TLS_CERT_ARN =
  "arn:aws:acm:eu-west-1:302477901552:certificate/564e2081-81f3-4250-a2a9-d2b88916483a";

export class SimpleAuthenticatedRestApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use AWS_PREFIX to give all resources in this sample
    // a unique name. This is usually `development-xx` where xx are your initials.
    // If you do not set AWS_PREFIX, when you deploy this stack, it may conflict
    // with someone elses stack who has also not set AWS_PREFIX
    const prefix = process.env.AWS_PREFIX
      ? process.env.AWS_PREFIX
      : "development-xx-";

    // AuthenticatedApi requires an existing SNS topic to publish alarms to.
    const alarmTopic = new sns.Topic(
      this,
      `${prefix}simple-authenticated-rest-api-alarm`,
      { topicName: `${prefix}simple-authenticated-rest-api-alarm` },
    );

    // VPC is optional. To use one, you would look it up as follows:
    // const vpc = ec2.Vpc.fromLookup(this, `${prefix}-vpc`, {
    //   vpcId: "vpc-0155db5e1ab5c28b6",
    // });

    // Setting a security group is an option. This is an example of importing and using a
    // pre existing security group. This one is defined in terraform.
    // An ulterior motive for importing this security group is that without specifying
    // one, the default group created will add significant time to deploy and destroy
    // steps in the build. This is not a problem IRL where the group will only be created
    // once instead of being created and destroyed on every build.
    // Note : Trying to configure the security group without providing a vpc results is the error:
    //   Error: Cannot configure 'securityGroups' without configuring a VPC
    // since CDK V2.
    //
    // const lambdaSecurityGroups = [
    //   ec2.SecurityGroup.fromSecurityGroupId(
    //     this,
    //     "a-talis-cdk-constructs-build",
    //     "sg-0ac646f0077b5ce03",
    //     {
    //       mutable: false,
    //     }
    //   ),
    // ];

    // Create the lambda's to be passed into the AuthenticatedApi construct
    const route1Handler = new AuthenticatedRestApiFunction(
      this,
      `${prefix}simple-authenticated-rest-api-route1-handler`,
      {
        name: `${prefix}-rest-api-route1-handler`,
        entry: "src/lambda/route1.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
        // A VPC is optional. If you need to specify one, you would do so here:
        // vpc: vpc,
        // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
      },
    );

    const route2Handler = new AuthenticatedRestApiFunction(
      this,
      `${prefix}simple-authenticated-rest-api-route2-handler`,
      {
        name: `${prefix}-rest-api-route2-handler`,
        entry: "src/lambda/route2.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
        // A VPC is optional. If you need to specify one, you would do so here:
        // vpc: vpc,
        // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
      },
    );

    const route3Handler = new AuthenticatedRestApiFunction(
      this,
      `${prefix}simple-authenticated-rest-api-route3-handler`,
      {
        name: `${prefix}-rest-api-route3-handler`,
        entry: "src/lambda/route3.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
      },
    );

    const route4Handler = new AuthenticatedRestApiFunction(
      this,
      `${prefix}simple-authenticated-rest-api-route4-handler`,
      {
        name: `${prefix}-rest-api-route4-handler`,
        entry: "src/lambda/route4.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
      },
    );

    new AuthenticatedRestApi(this, `${prefix}simple-authenticated-rest-api`, {
      prefix: prefix,
      name: "simple-authenticated-rest-api",
      description: "Simple Authenticated Rest API",
      stageName: "development", // This should be development / staging / production as appropriate
      alarmTopic,
      domainName: `${prefix}simple-authenticated-rest-api.talis.com`,
      certificateArn: STAGING_TALIS_TLS_CERT_ARN,

      persona: {
        host: "staging-users.talis.com",
        scheme: "https",
        port: "443",
        oauth_route: "/oauth/tokens/",
      },

      resourceProps: [
        {
          // www.example.com/simple-resource
          name: "simple-resource",
          methods: {
            GET: {
              function: route1Handler,
              lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
              isPublic: true,
            },
            POST: {
              function: route2Handler,
              lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
              isPublic: false, // This is the default
              requiredScope: "analytics:admin",
            },
          },
          nestedResources: [
            {
              // www.example.com/simple-resource/<simpleResourceId>
              name: "{simpleResourceId}",
              methods: {
                GET: {
                  function: route1Handler,
                  lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
                  isPublic: true,
                },
                PUT: {
                  function: route2Handler,
                  lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
                  isPublic: false, // This is the default
                },
                DELETE: {
                  function: route3Handler,
                  lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
                  isPublic: false, // This is the default
                },
              },
              nestedResources: [
                {
                  // www.example.com/simple-resource/<simpleResourceId>/child-resource
                  name: "child-resource",
                  methods: {
                    GET: {
                      function: route4Handler,
                      lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
                      isPublic: true,
                    },
                    POST: {
                      function: route4Handler,
                      lambdaDurationAlarmThreshold: cdk.Duration.seconds(30),
                      isPublic: false, // This is the default
                    },
                  },
                  nestedResources: [
                    {
                      // www.example.com/simple-resource/<simpleResourceId>/child-resource/<childResourceId>
                      name: "{childResourceId}",
                      methods: {
                        GET: {
                          function: route4Handler,
                          lambdaDurationAlarmThreshold:
                            cdk.Duration.seconds(30),
                          isPublic: true,
                        },
                        PUT: {
                          function: route4Handler,
                          lambdaDurationAlarmThreshold:
                            cdk.Duration.seconds(30),
                          isPublic: false, // This is the default
                        },
                        DELETE: {
                          function: route4Handler,
                          lambdaDurationAlarmThreshold:
                            cdk.Duration.seconds(30),
                          isPublic: false, // This is the default
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  }
}
