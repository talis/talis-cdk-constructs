import * as cdk from "aws-cdk-lib";
// import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_s3 as s3 } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import { Construct } from "constructs";

import { AuthenticatedApi, AuthenticatedApiFunction } from "../../../lib";

export const STAGING_TALIS_TLS_CERT_ARN =
  "arn:aws:acm:eu-west-1:302477901552:certificate/564e2081-81f3-4250-a2a9-d2b88916483a";

export class SimpleAuthenticatedApiStack extends cdk.Stack {
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
    // TODO : A real app would not create this topic which is already created by terraform.
    // Can we pull in this alarm which is defined in terraform as an example of how to do that
    const alarmTopic = new sns.Topic(
      this,
      `${prefix}simple-authenticated-api-alarm`,
      { topicName: `${prefix}simple-authenticated-api-alarm` },
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
    const route1Handler = new AuthenticatedApiFunction(
      this,
      `${prefix}simple-authenticated-api-route1-handler`,
      {
        name: `${prefix}route1-handler`,
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

    const route2Handler = new AuthenticatedApiFunction(
      this,
      `${prefix}simple-authenticated-api-route2-handler`,
      {
        name: `${prefix}route2-handler`,
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

    const route3Handler = new AuthenticatedApiFunction(
      this,
      `${prefix}simple-authenticated-api-route3-handler`,
      {
        name: `${prefix}route3-handler`,
        entry: "src/lambda/route3.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
      },
    );

    const route4Handler = new AuthenticatedApiFunction(
      this,
      `${prefix}simple-authenticated-api-route4-handler`,
      {
        name: `${prefix}route4-handler`,
        entry: "src/lambda/route4.js",
        environment: {},
        handler: "route",
        timeout: cdk.Duration.seconds(30),
        runtime: lambda.Runtime.NODEJS_22_X,
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
      },
    );

    const api = new AuthenticatedApi(
      this,
      `${prefix}simple-authenticated-api`,
      {
        prefix,
        name: `simple-authenticated-api`,
        description: "A simple example API",
        stageName: "development", // This should be development / staging / production as appropriate
        alarmTopic,
        // A VPC is optional. If you need to specify one, you would do so here:
        // vpc: vpc,
        // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
        // A security group is optional. If you need to specify one, you would do so here:
        // securityGroups: lambdaSecurityGroups,
        domainName: `${prefix}simple-authenticated-api.talis.com`,
        certificateArn: STAGING_TALIS_TLS_CERT_ARN,
        corsDomain: [
          "http://localhost:4200",
          `https://${prefix}simple-authenticated-api.talis.com`,
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
            path: "/1/route1",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route1Handler,
            requiredScope: "analytics:admin",
          },
          {
            name: "route2",
            path: "/1/route2",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route2Handler,
            isPublic: true,
          },
          {
            name: "route3",
            path: "/1/route3/{id}",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route3Handler,
            requiredScope: "analytics:admin",
          },
          {
            name: "route4",
            path: "/1/route4/{id}/route4",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route4Handler,
            requiredScope: "analytics:admin",
          },
          {
            // Authenticated, but no scope required
            name: "route5",
            path: "/1/route5",
            method: apigatewayv2.HttpMethod.GET,
            lambda: route2Handler,
          },
        ],
      },
    );

    // It's common to want to route to static content, for example api documentation.
    // This example is creating a bucket which will host documentation as a website.
    // A route is then added to the api to point to the bucket.
    // Note: The construct does not add the content to the bucket - you must do this yourself.
    const documentationBucket = new s3.Bucket(
      this,
      `${prefix}simple-authenticated-api-docs`,
      {
        bucketName: `${prefix}simple-authenticated-api-docs`,
        blockPublicAccess: {
          blockPublicAcls: false,
          blockPublicPolicy: false,
          ignorePublicAcls: false,
          restrictPublicBuckets: false,
        },
        publicReadAccess: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        websiteIndexDocument: "index.html",
      },
    );

    // Url Routes can be added in the initial props of the api construct, but they can also be
    // added using the following method
    api.addUrlRoute({
      name: "simple authenticated api docs",
      baseUrl: `${documentationBucket.bucketWebsiteUrl}/api-documentation/index.html`,
      path: "/api-documentation",
      method: apigatewayv2.HttpMethod.GET,
    });

    console.log(`Regional domain name: ${api.domainName.regionalDomainName}`);
    console.log(
      `Regional hosted zone id: ${api.domainName.regionalHostedZoneId}`,
    );
  }
}
