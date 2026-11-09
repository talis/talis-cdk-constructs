import * as cdk from "aws-cdk-lib";

import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { TalisCdkStackProps } from "./talis-cdk-stack-props";
import { TalisDeploymentEnvironment } from "./talis-deployment-environment";
import { getTalisShortRegionFromTalisRegion } from "./talis-region";
import { getTalisProductForApp } from "./talis-product";
import { Construct } from "constructs";

export class TalisCdkStack extends cdk.Stack {
  protected readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props: TalisCdkStackProps) {
    super(scope, id, props);
    if (props.vpcId) {
      this.vpc = this.resolveVpc(props.vpcId);
    }

    cdk.Tags.of(this).add("tfs-app", props.app); // e.g. depot
    cdk.Tags.of(this).add("talis:product", getTalisProductForApp(props.app)); // e.g. depot-serverless -> depot
    cdk.Tags.of(this).add("tfs-environment", props.deploymentEnvironment); // e.g. production staging development
    cdk.Tags.of(this).add("tfs-release", props.release); // e.g. 8561-105814f

    // props.env comes from aws cdk core StackProps. It's optional
    // so that an environment agnostic stack can be created.
    // If we create an environment agnostic stack - it can not contain
    // region or service.
    // However, when we deploy into our environments for real - props.env will be set
    if (props.env?.region) {
      const talisShortRegion = getTalisShortRegionFromTalisRegion(
        props.env.region,
      );
      if (talisShortRegion === undefined) {
        throw new Error(
          `Cannot resolve a tfs-region for props.env.region: '${props.env.region}'`,
        );
      }
      cdk.Tags.of(this).add("tfs-region", talisShortRegion);
      let tfsService;
      if (
        props.deploymentEnvironment === TalisDeploymentEnvironment.PRODUCTION
      ) {
        tfsService = `${props.app}-${talisShortRegion}`;
      } else {
        tfsService = `${props.app}-${props.deploymentEnvironment}-${talisShortRegion}`;
      }

      cdk.Tags.of(this).add("tfs-service", tfsService);
    }
  }

  getRemovalPolicyForTalisDeploymentEnvironment(
    environment: TalisDeploymentEnvironment,
  ): cdk.RemovalPolicy {
    switch (environment) {
      case TalisDeploymentEnvironment.BUILD:
      case TalisDeploymentEnvironment.DEVELOPMENT:
      case TalisDeploymentEnvironment.TEST:
        return cdk.RemovalPolicy.DESTROY;
      case TalisDeploymentEnvironment.STAGING:
        return cdk.RemovalPolicy.SNAPSHOT;
      case TalisDeploymentEnvironment.PRODUCTION:
      case TalisDeploymentEnvironment.PREVIEW:
        return cdk.RemovalPolicy.RETAIN;
      default:
        return cdk.RemovalPolicy.RETAIN;
    }
  }

  private resolveVpc(vpcId: string): ec2.IVpc {
    return ec2.Vpc.fromLookup(this, vpcId, { vpcId });
  }
}
