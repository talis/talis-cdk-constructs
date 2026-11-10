import * as cdk from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "node:path";

import { LambdaWorker } from "../../../lib";

export class ContainerLambdaWorkerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use AWS_PREFIX to give all resources in this sample
    // a unique name. This is usually `development-xx` where xx are your initials.
    // If you do not set AWS_PREFIX, when you deploy this stack, it may conflict
    // with someone elses stack who has also not set AWS_PREFIX
    const prefix = process.env.AWS_PREFIX
      ? process.env.AWS_PREFIX
      : "development-xx-";

    // The LambdaWorker will be triggered by a queue created in the construct.
    // Optionally, you can pass the LambdaWorker a pre-existing topic which
    // the queue will be subscribed to.
    //
    // This is useful when using Pub/Sub as depot-serverless does. A single
    // "File" topic is created which all workers subscribe to.
    const topic = new sns.Topic(
      this,
      `${prefix}container-lambda-worker-topic`,
      {
        topicName: `${prefix}container-lambda-worker-topic`,
      },
    );

    const vpc = ec2.Vpc.fromLookup(this, `${prefix}-vpc`, {
      vpcId: "vpc-0155db5e1ab5c28b6",
    });

    // Create the Lambda
    /* const worker = */ new LambdaWorker(
      this,
      `${prefix}container-lambda-worker`,
      {
        name: `${prefix}container-lambda-worker`,
        lambdaProps: {
          queueMaxConcurrency: 100,
          environment: {
            EXAMPLE_ENV_VAR: "example value",
          },
          imageAsset: {
            directory: path.join(__dirname, "../container"),
            props: {
              cmd: ["container-worker.containerLambdaWorker"],
            },
          },
          memorySize: 1024,
          timeout: cdk.Duration.minutes(5),
          vpc: vpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
        },
        queueProps: {
          maxReceiveCount: 3,
        },
        // onCallTeam: "talis-platform", // pages this Datadog On-Call team when an alarm fires

        // Subscribing to a topic is optional
        subscription: {
          topic: topic,
          // Without a filterPolicy the subscription will receive all messages
          // An optional filterPolicy can be aplied so only specific messages are received
          // This example is a real example from Depot's Pub/Sub architecture where we want messages containing:
          // { action: "COMPLETED", output_type: "DOCUMENT", mime_type: "application/pdf"
          filterPolicy: {
            action: sns.SubscriptionFilter.stringFilter({
              allowlist: ["COMPLETED"],
            }),
            output_type: sns.SubscriptionFilter.stringFilter({
              allowlist: ["DOCUMENT"],
            }),
            mime_type: sns.SubscriptionFilter.stringFilter({
              allowlist: ["application/pdf"],
            }),
          },
        },
      },
    );
  }
}
