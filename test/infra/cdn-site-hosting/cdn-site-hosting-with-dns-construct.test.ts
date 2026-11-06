import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { aws_s3_deployment as s3deploy } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CdnSiteHostingWithDnsConstruct } from "../../../lib/cdn-site-hosting";

// Keep assets tiny: staging the repo root would hash all of node_modules
const STATIC_SITE = path.resolve(__dirname, "../../fixtures/static-site");

// hosted-zone requires an environment be attached to the Stack
const testEnv: cdk.Environment = {
  region: "eu-west-1",
  account: "abcdefg12345",
};

const fakeSiteSubDomain = "test";
const fakeDomain = "example.com";
const fakeFqdn = `${fakeSiteSubDomain}.${fakeDomain}`;

describe("CdnSiteHostingWithDnsConstruct", () => {
  describe("With a provisioned Stack", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingWithDnsConstruct(stack, "MyTestConstruct", {
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset(STATIC_SITE)],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
      });
    });

    test("provisions an ACM TLS certificate covering the domain", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFormation::CustomResource",
        {
          DomainName: fakeFqdn,
          Region: "us-east-1",
        },
      );
    });

    test("provisions a single S3 bucket with website hosting configured", () => {
      Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
      Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
        BucketName: fakeFqdn,
        WebsiteConfiguration: {
          ErrorDocument: "error.html",
          IndexDocument: "index.html",
        },
      });
    });

    test("provisions a CloudFront distribution linked to S3", () => {
      Template.fromStack(stack).resourceCountIs(
        "AWS::CloudFront::Distribution",
        1,
      );
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFront::Distribution",
        {
          DistributionConfig: {
            Aliases: [fakeFqdn],
            DefaultRootObject: "index.html",
            ViewerCertificate: {
              AcmCertificateArn: {},
            },
          },
        },
      );
    });

    test("issues a bucket deployment with CloudFront invalidation for the specified sources", () => {
      Template.fromStack(stack).resourceCountIs(
        "Custom::CDKBucketDeployment",
        1,
      );
      Template.fromStack(stack).hasResourceProperties(
        "Custom::CDKBucketDeployment",
        {
          DistributionPaths: ["/*"],
        },
      );
    });

    test("provisions a Route 53 'A Record' covering the domain", () => {
      Template.fromStack(stack).resourceCountIs("AWS::Route53::RecordSet", 1);
      Template.fromStack(stack).hasResourceProperties(
        "AWS::Route53::RecordSet",
        {
          Name: `${fakeFqdn}.`,
          Type: "A",
        },
      );
    });
  });

  describe("When certificate is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingWithDnsConstruct(stack, "MyTestConstruct", {
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset(STATIC_SITE)],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
        certificateArn: "test-cert",
      });
    });

    test("does not provisions a new ACM TLS certificate covering the domain", () => {
      Template.fromStack(stack).resourceCountIs(
        "AWS::CloudFormation::CustomResource",
        0,
      );
    });
  });

  describe("When no error document is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingWithDnsConstruct(stack, "MyTestConstruct", {
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset(STATIC_SITE)],
        websiteIndexDocument: "index.html",
      });
    });

    test("provisions an ACM TLS certificate covering the domain", () => {
      Template.fromStack(stack).resourceCountIs(
        "AWS::CloudFormation::CustomResource",
        1,
      );
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFormation::CustomResource",
        {
          DomainName: fakeFqdn,
          Region: "us-east-1",
        },
      );
    });

    test("provisions a single S3 bucket with website hosting configured", () => {
      Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
      Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
        BucketName: fakeFqdn,
        WebsiteConfiguration: {
          IndexDocument: "index.html",
        },
      });
    });

    test("provisions a CloudFront distribution linked to S3", () => {
      Template.fromStack(stack).resourceCountIs(
        "AWS::CloudFront::Distribution",
        1,
      );
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFront::Distribution",
        {
          DistributionConfig: {
            Aliases: [fakeFqdn],
            DefaultRootObject: "index.html",
            ViewerCertificate: {
              AcmCertificateArn: {},
            },
          },
        },
      );
    });

    test("issues a bucket deployment with CloudFront invalidation for the specified sources", () => {
      Template.fromStack(stack).resourceCountIs(
        "Custom::CDKBucketDeployment",
        1,
      );
      Template.fromStack(stack).hasResourceProperties(
        "Custom::CDKBucketDeployment",
        {
          DistributionPaths: ["/*"],
        },
      );
    });

    test("provisions a Route 53 'A Record' covering the domain", () => {
      Template.fromStack(stack).resourceCountIs("AWS::Route53::RecordSet", 1);
      Template.fromStack(stack).hasResourceProperties(
        "AWS::Route53::RecordSet",
        {
          Name: `${fakeFqdn}.`,
          Type: "A",
        },
      );
    });
  });

  describe("For a routed SPA", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingWithDnsConstruct(stack, "MyTestConstruct", {
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset(STATIC_SITE)],
        websiteIndexDocument: "index.html",
      });
    });

    test("configures a custom error response code override in CloudFront", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFront::Distribution",
        {
          DistributionConfig: {
            CustomErrorResponses: [
              {
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: "/index.html",
              },
            ],
          },
        },
      );
    });
    test("configures an error document in S3", () => {
      Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
        WebsiteConfiguration: {
          IndexDocument: "index.html",
          ErrorDocument: "index.html",
        },
      });
    });
  });

  describe("For a routed SPA when error document is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingWithDnsConstruct(stack, "MyTestConstruct", {
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset(STATIC_SITE)],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
      });
    });

    test("configures a custom error response code override in CloudFront", () => {
      Template.fromStack(stack).hasResourceProperties(
        "AWS::CloudFront::Distribution",
        {
          DistributionConfig: {
            CustomErrorResponses: [
              {
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: "/index.html",
              },
            ],
          },
        },
      );
    });
    test("configures an error document in S3", () => {
      Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
        WebsiteConfiguration: {
          ErrorDocument: "error.html",
          IndexDocument: "index.html",
        },
      });
    });
  });
});
