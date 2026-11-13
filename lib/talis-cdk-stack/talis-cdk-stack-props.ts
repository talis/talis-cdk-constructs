import * as cdk from "aws-cdk-lib";
import { TalisDeploymentEnvironment } from "./talis-deployment-environment";

export interface TalisCdkStackProps extends cdk.StackProps {
  // ID of the VPC to deploy stack resources into
  readonly vpcId?: string;
  // Environment the stack is deployed into
  readonly deploymentEnvironment: TalisDeploymentEnvironment;

  // The following are used to create tags on the cloud formation stack.
  readonly release: string; // tag tfs-release
  readonly app: string; // tag tfs-app
  // Product this app belongs to, from the Talis tagging reference (e.g. depot
  // for depot-serverless). Tag talis:product; defaults to app.
  readonly product?: string;
}
