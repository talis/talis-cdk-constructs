#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SimpleAuthenticatedRestApiStack } from "../lib/simple-authenticated-rest-api-stack";
import { TalisDeploymentEnvironment } from "../../../lib";

const buildStackTtl = Math.floor(
  (Date.now() + cdk.Duration.days(3).toMilliseconds()) / 1000,
).toString();

const app = new cdk.App();
new SimpleAuthenticatedRestApiStack(
  app,
  `${process.env.AWS_PREFIX}SimpleAuthenticatedRestApiStack`,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    tags: {
      // Auto-expire this stack if created by a build system
      ...(process.env.CI
        ? { env: TalisDeploymentEnvironment.BUILD, ttl: buildStackTtl }
        : undefined),
    },
  },
);
