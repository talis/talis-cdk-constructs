#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SimpleTalisCdkStack } from "../lib/simple-talis-cdk-stack";
import { TalisDeploymentEnvironment } from "../../../lib";

const buildStackTtl = Math.floor(
  (Date.now() + cdk.Duration.days(3).toMilliseconds()) / 1000,
).toString();

const app = new cdk.App();
new SimpleTalisCdkStack(
  app,
  `${process.env.AWS_PREFIX}SimpleTalisCdkStackStack`,
  {
    release: "0.1.0",
    app: "simple-talis-cdk-stack",
    deploymentEnvironment: TalisDeploymentEnvironment.DEVELOPMENT,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    tags: {
      // Auto-expire this stack if created by a build system
      ...(process.env.CI ? { ttl: buildStackTtl } : undefined),
    },
  },
);
