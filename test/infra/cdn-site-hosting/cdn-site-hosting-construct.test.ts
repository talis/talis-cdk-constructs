import * as cdk from "aws-cdk-lib";
import { aws_cloudfront as cloudfront } from "aws-cdk-lib";
import { aws_s3_deployment as s3deploy } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CdnSiteHostingConstruct } from "../../../lib/cdn-site-hosting";

// hosted-zone requires an environment be attached to the Stack
const testEnv: cdk.Environment = {
  region: "eu-west-1",
  account: "abcdefg12345",
};
const fakeCertificateArn = `arn:aws:acm:${testEnv.region}:${testEnv.account}:certificate/123456789012-1234-1234-1234-12345678`;

const fakeSiteSubDomain = "test";
const fakeDomain = "example.com";
const fakeFqdn = `${fakeSiteSubDomain}.${fakeDomain}`;

describe("CdnSiteHostingConstruct", () => {
  describe("With a provisioned Stack", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
      });
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
              AcmCertificateArn: fakeCertificateArn,
              MinimumProtocolVersion: "TLSv1.1_2016",
              SslSupportMethod: "sni-only",
            },
            Origins: [
              {
                CustomOriginConfig: {
                  OriginProtocolPolicy: "http-only",
                },
              },
            ],
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

    test("gives the bucket deployment lambda 1024MB of memory by default", () => {
      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        MemorySize: 1024,
      });
    });
  });

  describe("When bucketDeploymentMemoryLimit is provided", () => {
    test("uses it for the bucket deployment lambda with sources", () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteIndexDocument: "index.html",
        bucketDeploymentMemoryLimit: 2048,
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        MemorySize: 2048,
      });
    });

    test("uses it for the bucket deployment lambda with sourcesWithDeploymentOptions", () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sourcesWithDeploymentOptions: [
          { sources: [s3deploy.Source.asset("./")] },
        ],
        websiteIndexDocument: "index.html",
        bucketDeploymentMemoryLimit: 2048,
      });

      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        MemorySize: 2048,
      });
    });
  });

  describe("When no error document is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteIndexDocument: "index.html",
      });
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
              AcmCertificateArn: fakeCertificateArn,
            },
            Origins: [
              {
                CustomOriginConfig: {
                  OriginProtocolPolicy: "http-only",
                },
              },
            ],
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
  });

  describe("When an invalid index document path is provided", () => {
    test("provisions a single S3 bucket with website hosting configured", () => {
      const app = new cdk.App();
      const stack: cdk.Stack = new cdk.Stack(app, "TestStack", {
        env: testEnv,
      });

      expect(
        () =>
          new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
            certificateArn: fakeCertificateArn,
            siteSubDomain: fakeSiteSubDomain,
            domainName: fakeDomain,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            sources: [s3deploy.Source.asset("./")],
            websiteErrorDocument: "error.html",
            websiteIndexDocument: "/index.html",
          }),
      ).toThrow("leading slashes are not allowed in websiteIndexDocument");
    });
  });

  describe("For a routed SPA", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset("./")],
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

  describe("For a routed SPA when an error document is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset("./")],
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
          IndexDocument: "index.html",
          ErrorDocument: "error.html",
        },
      });
    });
  });

  describe("When sourcesWithDeploymentOptions is provided", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sourcesWithDeploymentOptions: [
          {
            name: "source1",
            sources: [s3deploy.Source.asset("./", { exclude: ["index.html"] })],
          },
          {
            name: "source2",
            sources: [
              s3deploy.Source.asset("./", { exclude: ["*", "!index.html"] }),
            ],
          },
        ],
        websiteIndexDocument: "index.html",
      });
    });

    test("provisions a single S3 bucket with website hosting configured", () => {
      Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
      Template.fromStack(stack).hasResourceProperties("AWS::S3::Bucket", {
        BucketName: fakeFqdn,
        WebsiteConfiguration: {
          IndexDocument: "index.html",
          ErrorDocument: "index.html",
        },
      });
    });

    test("configures all S3 deployments sequentially, with each deployment depending on the previous one", () => {
      const template = Template.fromStack(stack);
      const deployments = Object.entries(
        template.findResources("Custom::CDKBucketDeployment"),
      );
      expect(deployments.length).toBe(2);
      const [[firstDeploymentId, firstDeployment], [, secondDeployment]] =
        deployments;
      expect(firstDeployment.DependsOn).toBeDefined();
      expect(firstDeployment.DependsOn).toContain(
        "MyTestConstructSiteBucketEE4FFC1B",
      );
      expect(secondDeployment.DependsOn).toBeDefined();
      expect(secondDeployment.DependsOn).toContain(firstDeploymentId);
    });

    test("gives the bucket deployment lambda 1024MB of memory by default", () => {
      Template.fromStack(stack).hasResourceProperties("AWS::Lambda::Function", {
        MemorySize: 1024,
      });
    });
  });

  describe("can be provisioned with a specific TSL version", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
        securityPolicyProtocol: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
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
              AcmCertificateArn: fakeCertificateArn,
              MinimumProtocolVersion: "TLSv1.2_2021",
              SslSupportMethod: "sni-only",
            },
            Origins: [
              {
                CustomOriginConfig: {
                  OriginProtocolPolicy: "http-only",
                },
              },
            ],
          },
        },
      );
    });
  });
});
