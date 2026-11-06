import * as cdk from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambda_nodejs } from "aws-cdk-lib";

export interface AuthenticatedApiFunctionProps extends Pick<
  lambda_nodejs.NodejsFunctionProps,
  | "entry"
  | "handler"
  | "runtime"
  | "awsSdkConnectionReuse"
  | "depsLockFilePath"
  | "bundling"
  | "projectRoot"
> {
  name: string;
  entry: string;
  environment?: { [key: string]: string };
  handler: string;
  timeout: cdk.Duration;
  vpc?: ec2.IVpc;
  vpcSubnets?: ec2.SubnetSelection;
  securityGroups?: Array<ec2.ISecurityGroup>;
  memorySize?: number;
  /** @default true */
  awsSdkConnectionReuse?: boolean;
  runtime: cdk.aws_lambda.Runtime;
}
