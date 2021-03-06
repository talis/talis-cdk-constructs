import {
  expect as expectCDK,
  countResources,
  haveResource,
  haveResourceLike,
} from "@aws-cdk/assert";
import * as cdk from "@aws-cdk/core";
import { Environment, RemovalPolicy, Stack } from "@aws-cdk/core";
import * as s3deploy from "@aws-cdk/aws-s3-deployment";
import { CdnSiteHostingConstruct } from "../../../lib/cdn-site-hosting";
import { Template } from "@aws-cdk/assertions";

// hosted-zone requires an environment be attached to the Stack
const testEnv: Environment = {
  region: "eu-west-1",
  account: "abcdefg12345",
};
const fakeCertificateArn = `arn:aws:acm:${testEnv.region}:${testEnv.account}:certificate/123456789012-1234-1234-1234-12345678`;

const fakeSiteSubDomain = "test";
const fakeDomain = "example.com";
const fakeFqdn = `${fakeSiteSubDomain}.${fakeDomain}`;

describe("CdnSiteHostingConstruct", () => {
  describe("With a provisioned Stack", () => {
    let stack: Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
      });
    });

    test("provisions a single S3 bucket with website hosting configured", () => {
      expectCDK(stack).to(countResources("AWS::S3::Bucket", 1));
      expectCDK(stack).to(
        haveResource("AWS::S3::Bucket", {
          BucketName: fakeFqdn,
          WebsiteConfiguration: {
            ErrorDocument: "error.html",
            IndexDocument: "index.html",
          },
        })
      );
    });

    test("provisions a CloudFront distribution linked to S3", () => {
      expectCDK(stack).to(countResources("AWS::CloudFront::Distribution", 1));
      expectCDK(stack).to(
        haveResourceLike("AWS::CloudFront::Distribution", {
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
        })
      );
    });

    test("issues a bucket deployment with CloudFront invalidation for the specified sources", () => {
      expectCDK(stack).to(countResources("Custom::CDKBucketDeployment", 1));
      expectCDK(stack).to(
        haveResourceLike("Custom::CDKBucketDeployment", {
          DistributionPaths: ["/*"],
        })
      );
    });
  });

  describe("When no error document is provided", () => {
    let stack: Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: RemovalPolicy.DESTROY,
        sources: [s3deploy.Source.asset("./")],
        websiteIndexDocument: "index.html",
      });
    });

    test("provisions a single S3 bucket with website hosting configured", () => {
      expectCDK(stack).to(countResources("AWS::S3::Bucket", 1));
      expectCDK(stack).to(
        haveResource("AWS::S3::Bucket", {
          BucketName: fakeFqdn,
          WebsiteConfiguration: {
            IndexDocument: "index.html",
          },
        })
      );
    });

    test("provisions a CloudFront distribution linked to S3", () => {
      expectCDK(stack).to(countResources("AWS::CloudFront::Distribution", 1));
      expectCDK(stack).to(
        haveResourceLike("AWS::CloudFront::Distribution", {
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
        })
      );
    });

    test("issues a bucket deployment with CloudFront invalidation for the specified sources", () => {
      expectCDK(stack).to(countResources("Custom::CDKBucketDeployment", 1));
      expectCDK(stack).to(
        haveResourceLike("Custom::CDKBucketDeployment", {
          DistributionPaths: ["/*"],
        })
      );
    });
  });

  describe("When an invalid index document path is provided", () => {
    test("provisions a single S3 bucket with website hosting configured", () => {
      const app = new cdk.App();
      const stack: Stack = new cdk.Stack(app, "TestStack", { env: testEnv });

      expect(
        () =>
          new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
            certificateArn: fakeCertificateArn,
            siteSubDomain: fakeSiteSubDomain,
            domainName: fakeDomain,
            removalPolicy: RemovalPolicy.DESTROY,
            sources: [s3deploy.Source.asset("./")],
            websiteErrorDocument: "error.html",
            websiteIndexDocument: "/index.html",
          })
      ).toThrow("leading slashes are not allowed in websiteIndexDocument");
    });
  });

  describe("For a routed SPA", () => {
    let stack: Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset("./")],
        websiteIndexDocument: "index.html",
      });
    });

    test("configures a custom error response code override in CloudFront", () => {
      expectCDK(stack).to(
        haveResourceLike("AWS::CloudFront::Distribution", {
          DistributionConfig: {
            CustomErrorResponses: [
              {
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: "/index.html",
              },
            ],
          },
        })
      );
    });
    test("configures an error document in S3", () => {
      expectCDK(stack).to(
        haveResourceLike("AWS::S3::Bucket", {
          WebsiteConfiguration: {
            IndexDocument: "index.html",
            ErrorDocument: "index.html",
          },
        })
      );
    });
  });

  describe("For a routed SPA when an error document is provided", () => {
    let stack: Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: RemovalPolicy.DESTROY,
        isRoutedSpa: true,
        sources: [s3deploy.Source.asset("./")],
        websiteErrorDocument: "error.html",
        websiteIndexDocument: "index.html",
      });
    });

    test("configures a custom error response code override in CloudFront", () => {
      expectCDK(stack).to(
        haveResourceLike("AWS::CloudFront::Distribution", {
          DistributionConfig: {
            CustomErrorResponses: [
              {
                ErrorCode: 404,
                ResponseCode: 200,
                ResponsePagePath: "/index.html",
              },
            ],
          },
        })
      );
    });
    test("configures an error document in S3", () => {
      expectCDK(stack).to(
        haveResourceLike("AWS::S3::Bucket", {
          WebsiteConfiguration: {
            IndexDocument: "index.html",
            ErrorDocument: "error.html",
          },
        })
      );
    });
  });

  describe("When sourcesWithDeploymentOptions is provided", () => {
    let stack: Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestRoutedSPAStack", { env: testEnv });
      new CdnSiteHostingConstruct(stack, "MyTestConstruct", {
        certificateArn: fakeCertificateArn,
        siteSubDomain: fakeSiteSubDomain,
        domainName: fakeDomain,
        removalPolicy: RemovalPolicy.DESTROY,
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
      expectCDK(stack).to(countResources("AWS::S3::Bucket", 1));
      expectCDK(stack).to(
        haveResource("AWS::S3::Bucket", {
          BucketName: fakeFqdn,
          WebsiteConfiguration: {
            IndexDocument: "index.html",
            ErrorDocument: "index.html",
          },
        })
      );
    });

    test("configures all S3 deployments sequentially, with each deployment depending on the previous one", () => {
      const template = Template.fromStack(stack);
      const deployments = Object.entries(
        template.findResources("Custom::CDKBucketDeployment")
      );
      expect(deployments.length).toBe(2);
      const [[firstDeploymentId, firstDeployment], [, secondDeployment]] =
        deployments;
      expect(firstDeployment.DependsOn).toBeUndefined();
      expect(secondDeployment.DependsOn).toBeDefined();
      expect(secondDeployment.DependsOn).toContain(firstDeploymentId);
    });
  });
});
