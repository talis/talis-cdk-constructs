import * as cdk from "aws-cdk-lib";
import { aws_certificatemanager as certificatemanager } from "aws-cdk-lib";
import { aws_cloudfront as cloudfront } from "aws-cdk-lib";
import { aws_s3 as s3 } from "aws-cdk-lib";
import { aws_s3_deployment as s3deploy } from "aws-cdk-lib";
import { getSiteDomain, getAliases } from "./utils";
import { CommonCdnSiteHostingProps } from "./cdn-site-hosting-props";
import { Construct } from "constructs";

export interface CdnSiteHostingConstructProps
  extends CommonCdnSiteHostingProps {
  certificateArn: string;
}

/**
 * Establishes infrastructure to host a static-site or single-page-application in S3 via CloudFront.
 *
 * This construct will:
 * - Create an S3 bucket with static website hosting enabled
 * - Create a CloudFront web distribution to deliver site content
 * - Register the CloudFront distribution with the provided certificate
 * - Deploy provided source code to S3 and invalidate the CloudFront distribution
 */
export class CdnSiteHostingConstruct extends Construct {
  public readonly s3Bucket: s3.Bucket;
  public readonly cloudfrontWebDistribution: cloudfront.CloudFrontWebDistribution;

  constructor(
    scope: Construct,
    id: string,
    props: CdnSiteHostingConstructProps,
  ) {
    super(scope, id);

    validateProps(props);

    const siteDomain = getSiteDomain(props);

    const aliases = getAliases(props);

    const securityPolicProtocol = props.securityPolicyProtocol
      ? props.securityPolicyProtocol
      : cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016;

    // certificate
    const viewerCertificate = cloudfront.ViewerCertificate.fromAcmCertificate(
      certificatemanager.Certificate.fromCertificateArn(
        this,
        `${siteDomain}-cert`,
        props.certificateArn,
      ),
      {
        aliases: [siteDomain, ...aliases],
        sslMethod: cloudfront.SSLMethod.SNI,
        securityPolicy: securityPolicProtocol,
      },
    );

    let websiteErrorDocument: string | undefined = props.websiteErrorDocument;
    if (!websiteErrorDocument) {
      websiteErrorDocument = props.isRoutedSpa
        ? props.websiteIndexDocument
        : undefined;
    }

    // S3 bucket
    this.s3Bucket = new s3.Bucket(this, "SiteBucket", {
      bucketName: siteDomain,
      websiteIndexDocument: props.websiteIndexDocument,
      websiteErrorDocument,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      publicReadAccess: true,
      removalPolicy: props.removalPolicy,
      autoDeleteObjects: props.removalPolicy === cdk.RemovalPolicy.DESTROY,
    });
    new cdk.CfnOutput(this, "Bucket", { value: this.s3Bucket.bucketName });

    // Cloudfront distribution
    this.cloudfrontWebDistribution = new cloudfront.CloudFrontWebDistribution(
      this,
      "SiteDistribution",
      {
        viewerCertificate,
        originConfigs: [
          {
            // We use a custom origin rather than S3 origin because the latter
            // does not seem to support websiteErrorDocument correctly
            customOriginSource: {
              domainName: this.s3Bucket.bucketWebsiteDomainName,
              originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            },
            behaviors: [{ isDefaultBehavior: true }],
          },
        ],
        errorConfigurations: props.isRoutedSpa
          ? [
              {
                errorCode: 404,
                responseCode: 200,
                responsePagePath: `/${props.websiteIndexDocument}`,
              },
            ]
          : undefined,
      },
    );
    new cdk.CfnOutput(this, "DistributionId", {
      value: this.cloudfrontWebDistribution.distributionId,
    });

    // Deploy site contents to S3 bucket
    if (props.sourcesWithDeploymentOptions) {
      const isSingleDeploymentStep =
        props.sourcesWithDeploymentOptions.length === 1;

      // multiple sources with granular cache and invalidation control
      const deployments = props.sourcesWithDeploymentOptions.map(
        (
          { name, sources, distributionPathsToInvalidate, cacheControl },
          index,
        ) => {
          const isInvalidationRequired =
            distributionPathsToInvalidate &&
            distributionPathsToInvalidate.length > 0;

          const nameOrIndex = name ? name : `${index}`;

          return new s3deploy.BucketDeployment(
            this,
            `CustomDeploy${nameOrIndex}`,
            {
              cacheControl,
              sources: sources,
              memoryLimit: props.bucketDeploymentMemoryLimit ?? 1024,
              prune: isSingleDeploymentStep,
              destinationBucket: this.s3Bucket,
              distribution: isInvalidationRequired
                ? this.cloudfrontWebDistribution
                : undefined,
              distributionPaths: isInvalidationRequired
                ? distributionPathsToInvalidate
                : undefined,
            },
          );
        },
      );

      // Give the first deployment a dependency on the s3 bucket.
      // Without this, we may start copying files into the s3 bucket before it has been created.
      deployments[0].node.addDependency(this.s3Bucket);
      // Now make the rest of the deployments dependent on the previous one.
      deployments.forEach((deployment, deploymentIndex) => {
        if (deploymentIndex > 0) {
          deployment.node.addDependency(deployments[deploymentIndex - 1]);
        }
      });
    } else if (props.sources) {
      // multiple sources, with default cache-control and wholesale invalidation
      new s3deploy.BucketDeployment(this, "DeployAndInvalidate", {
        memoryLimit: props.bucketDeploymentMemoryLimit ?? 1024,
        sources: props.sources,
        destinationBucket: this.s3Bucket,
        distribution: this.cloudfrontWebDistribution,
        distributionPaths: ["/*"],
      });
    }
  }
}

function validateProps(props: CdnSiteHostingConstructProps): void {
  const { sources, sourcesWithDeploymentOptions, websiteIndexDocument } = props;

  // validate source specifications
  if (!sources && !sourcesWithDeploymentOptions) {
    throw new Error(
      "Either `sources` or `sourcesWithDeploymentOptions` must be specified",
    );
  } else if (sources && sourcesWithDeploymentOptions) {
    throw new Error(
      "Either `sources` or `sourcesWithDeploymentOptions` may be specified, but not both.",
    );
  } else if (
    sourcesWithDeploymentOptions &&
    sourcesWithDeploymentOptions.length === 0
  ) {
    throw new Error(
      "If specified, `sourcesWithDeploymentOptions` cannot be empty",
    );
  } else if (
    sourcesWithDeploymentOptions &&
    sourcesWithDeploymentOptions.some(({ sources }) => sources.length === 0)
  ) {
    throw new Error("`sourcesWithDeploymentOptions.sources` cannot be empty");
  } else if (sources && sources.length === 0) {
    throw new Error("If specified, `sources` cannot be empty");
  }

  if (websiteIndexDocument.startsWith("/")) {
    throw Error("leading slashes are not allowed in websiteIndexDocument");
  }
}
