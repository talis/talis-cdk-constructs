import * as cdk from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambda_nodejs } from "aws-cdk-lib";

// Lambda properties for different runtimes
export interface FunctionLambdaProps
  extends Pick<
    lambda_nodejs.NodejsFunctionProps,
    | "entry"
    | "handler"
    | "runtime"
    | "awsSdkConnectionReuse"
    | "depsLockFilePath"
    | "bundling"
    | "projectRoot"
  > {
  handler: string;
  entry: string;
  /** @default true */
  awsSdkConnectionReuse?: boolean;
  runtime: lambda.Runtime;
}

export interface ContainerFromEcrLambdaProps {
  ecrRepositoryArn: string;
  ecrRepositoryName: string;
  dockerImageTag: string;
  dockerCommand?: string;
}

export interface ContainerFromImageAssetLambdaProps {
  /** Create an ECR image from the specified asset and bind it as the Lambda code */
  imageAsset: {
    directory: string;
    props?: lambda.AssetImageCodeProps;
  };
}

export interface LambdaWorkerProps {
  // The name of the LambdaWorker
  name: string;

  // Lambda Properties
  // Documented here https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda-nodejs.NodejsFunctionProps.html
  lambdaProps: {
    description?: string;
    enableQueue?: boolean;
    environment?: { [key: string]: string };
    ephemeralStorageSize?: cdk.Size;
    filesystem?: lambda.FileSystem;
    memorySize: number; // LambdaWorker will set a minimum memory size of 1024
    policyStatements?: iam.PolicyStatement[];
    reservedConcurrentExecutions?: number;
    retryAttempts?: number;
    securityGroups?: Array<ec2.ISecurityGroup>;
    timeout: cdk.Duration;
    vpc?: ec2.IVpc;
    vpcSubnets?: ec2.SubnetSelection;
    queueMaxConcurrency: number;
    queueTimeout?: cdk.Duration;
  } & Partial<FunctionLambdaProps> &
    Partial<ContainerFromEcrLambdaProps> &
    Partial<ContainerFromImageAssetLambdaProps>;

  // Optional larger lambdas a failed job escalates to, in order. Each tier
  // gets its own queue (named with a -01, -02... suffix) and the last tier's
  // failures land on the DLQ. Unspecified values are taken from lambdaProps.
  fallbacks?: Array<{
    memorySize?: number;
    ephemeralStorageSize?: cdk.Size;
  }>;

  // Queue Properties
  queueProps?: {
    // The maximum number of times a message is re-tried before
    // going to the DLQ. This will default to 5
    maxReceiveCount?: number;

    // The threshold for age of oldest message alarm
    // i.e. An alarm will be triggered when messages have not been processed
    // within this duration.
    // This will default to 1 hour.
    approximateAgeOfOldestMessageThreshold?: cdk.Duration;

    // The threshold for the alarm on the ApproximateNumberOfMessagesVisible metric
    // i.e. An alarm will be triggered if more than this number of messages is on the queue
    approximateNumberOfMessagesVisibleThreshold?: number;

    // Use a FIFO queue. Defaults to false;
    fifo?: boolean;
    contentBasedDeduplication?: boolean;
  };

  // SNS Topic all alarm actions should be sent to
  alarmTopic: sns.ITopic;

  // Optional subscribe to SNS topic options
  subscription?: {
    // Optionally specify a topic to subscribe the lambda's SQS queue to.
    topic?: sns.Topic;

    filterPolicy?: { [key: string]: sns.SubscriptionFilter };
  };
}
