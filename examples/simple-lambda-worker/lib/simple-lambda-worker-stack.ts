import * as cdk from "aws-cdk-lib";
// import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_sqs as sqs } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { Construct } from "constructs";

import { LambdaWorker } from "../../../lib";

export class SimpleLambdaWorkerStack extends cdk.Stack {
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
    const topic = new sns.Topic(this, `${prefix}simple-lambda-worker-topic`, {
      topicName: `${prefix}simple-lambda-worker-topic`,
      fifo: true,
    });

    // VPC is optional. To use one, you would look it up as follows:
    // const vpc = ec2.Vpc.fromLookup(this, `${prefix}-vpc`, {
    //   vpcId: "vpc-0155db5e1ab5c28b6",
    // });

    // Setting a security group is an option. This is an example of importing and using a
    // pre existing security group. This one is defined in terraform.
    // An ulterior motive for importing this security group is that without specifying
    // one, the default group created will add significant time to deploy and destroy
    // steps in the build. This is not a problem IRL where the group will only be created
    // once instead of being created and destroyed on every build.
    // Note : Trying to configure the security group without providing a vpc results is the error:
    //   Error: Cannot configure 'securityGroups' without configuring a VPC
    // since CDK V2.
    // const lambdaSecurityGroups = [
    //   ec2.SecurityGroup.fromSecurityGroupId(
    //     this,
    //     "a-talis-cdk-constructs-build",
    //     "sg-0ac646f0077b5ce03",
    //     {
    //       mutable: false,
    //     }
    //   ),
    // ];

    // In this example, and to aid integration tests, after successfully processing
    // a message the lambda worker will send a new messages to an SQS queue.
    // This is a common thing for the worker to do - passing to the next
    // worker in the chain. See Echo-Serverless as an example of this.
    // Create a queue to recieve the message.
    const successQueue = new sqs.Queue(this, `${prefix}success`, {
      queueName: `${prefix}simple-lambda-worker-success`,
    });

    // Create the Lambda
    /* const worker = */ new LambdaWorker(
      this,
      `${prefix}simple-lambda-worker`,
      {
        name: `${prefix}simple-lambda-worker`,
        lambdaProps: {
          queueMaxConcurrency: 5,
          environment: {
            EXAMPLE_ENV_VAR: "example value",
            SUCCESS_QUEUE_URL: successQueue.queueUrl,
          },
          entry: "src/lambda/simple-worker.js",
          handler: "simpleLambdaWorker",
          runtime: lambda.Runtime.NODEJS_22_X,
          memorySize: 1024,
          // A security group is optional. If you need to specify one, you would do so here:
          // securityGroups: lambdaSecurityGroups,
          timeout: cdk.Duration.seconds(30),
          // A VPC is optional. If you need to specify one, you would do so here:
          // vpc: vpc,
          // vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_NAT },
          policyStatements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sqs:SendMessage"],
              resources: [successQueue.queueArn],
            }),
          ],
        },
        queueProps: {
          maxReceiveCount: 1,
          // If you want the lambda to use a fifo queue, you would do so here:
          fifo: true,
          contentBasedDeduplication: false,
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
