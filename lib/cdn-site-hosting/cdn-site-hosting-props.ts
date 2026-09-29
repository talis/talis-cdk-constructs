import * as cdk from "aws-cdk-lib";
import { aws_cloudfront as cloudfront } from "aws-cdk-lib";
import { aws_s3_deployment as s3deploy } from "aws-cdk-lib";

export interface SourcesWithDeploymentOptions {
  name?: string;
  sources: s3deploy.ISource[];
  distributionPathsToInvalidate?: string[];
  cacheControl?: s3deploy.CacheControl[];
}

export interface CommonCdnSiteHostingProps {
  domainName: string;
  removalPolicy: cdk.RemovalPolicy;
  siteSubDomain: string;
  aliasSubDomains?: string[];
  isRoutedSpa?: boolean;
  sources?: s3deploy.ISource[];
  sourcesWithDeploymentOptions?: SourcesWithDeploymentOptions[];
  websiteErrorDocument?: string;
  websiteIndexDocument: string;
  securityPolicyProtocol?: cloudfront.SecurityPolicyProtocol;
  bucketDeploymentMemoryLimit?: number;
}
