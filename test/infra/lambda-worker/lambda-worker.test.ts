import * as cdk from "aws-cdk-lib";
import * as path from "path";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_iam as iam } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { LambdaWorker, LambdaWorkerProps } from "../../../lib/lambda-worker";

describe("LambdaWorker", () => {
  describe("function lambda", () => {
    describe("with only required props", () => {
      let stack: cdk.Stack;
      let worker: LambdaWorker;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        worker = new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            policyStatements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["sqs:*"],
                resources: ["*"],
              }),
            ],
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      });

      test("provisions a lambda", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);
        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            FunctionName: "MyTestLambdaWorker",
            MemorySize: 2048,
            Timeout: 300,
            Handler: "index.testWorker",
            Runtime: "nodejs22.x",
            Environment: {
              Variables: {
                AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
                LAMBDA_EXECUTION_TIMEOUT: "300",
              },
            },
          },
        );
      });

      test.skip("exposes the sqs queue url and arn", () => {
        // This test does not work. In this test suite the construct has been created,
        // but the value of these properties are Tokens. e.g. "${Token[TOKEN.266]}"
        // See: https://github.com/aws/aws-cdk/issues/7258
        // And the reply it links to here: https://github.com/aws/aws-cdk/issues/7079#issuecomment-606394303
        // The tokens are not resolved into URL's until the `prepare` phase
        // This has not happened due to the way we are unit testing the constructs here.
        // We have a ticket to add integration tests for these constructs:
        // https://github.com/talis/platform/issues/5204
        // These will be tested in those integration tests.
        expect(worker.lambdaQueueUrl).toBe("expected url");
        expect(worker.lambdaQueueArn).toBe("expected arn");
      });

      test("provisions SQS queue and dead letter queue", () => {
        Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 2);

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-queue",
          VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
          MessageRetentionPeriod: 1209600, // 14 days
          RedrivePolicy: {
            maxReceiveCount: 5,
            deadLetterTargetArn: {
              "Fn::GetAtt": [
                "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                "Arn",
              ],
            },
          },
        });

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-dlq",
          VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
          MessageRetentionPeriod: 1209600, // 14 days
        });
      });

      test("provisions Lambda EventSourceMapping", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::EventSourceMapping",
          {
            Enabled: true,
            BatchSize: 1,
            ScalingConfig: {
              MaximumConcurrency: 5,
            },
          },
        );

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::EventSourceMapping",
          {
            Enabled: false,
            BatchSize: 1,
            ScalingConfig: {
              MaximumConcurrency: 5,
            },
          },
        );
      });

      test("provisions three alarms", () => {
        Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 3);
      });

      test("provisions a message visible alarm on the dead letter queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-dlq-messages-visible-alarm",
            AlarmDescription:
              "Alarm when the lambda worker fails to process a message and the message appears on the DLQ",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateNumberOfMessagesVisible",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Sum",
            Threshold: 1,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });

      test("provisions a message visible alarm on the main queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-queue-messages-visible-alarm",
            AlarmDescription:
              "Alarm when the lambda workers main trigger queue has more than 1000 messages on the queue",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateNumberOfMessagesVisible",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Sum",
            Threshold: 1000,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });

      test("provisions an age of oldest message alarm on the main queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-queue-message-age-alarm",
            AlarmDescription:
              "Alarm when the lambda workers main trigger queue has messages older than 3600 seconds",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateAgeOfOldestMessage",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerqueue01D6E79E",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Average",
            Threshold: 3600,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });
    });

    describe("with optional props", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            runtime: lambda.Runtime.NODEJS_22_X,

            // Optional
            description: "Test Description",
            ephemeralStorageSize: cdk.Size.mebibytes(1024),
            environment: {
              TALIS_ENV_VAR: "some value",
            },
            reservedConcurrentExecutions: 10,
            queueTimeout: cdk.Duration.seconds(90),
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      });

      test("provisions a lambda", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            FunctionName: "MyTestLambdaWorker",
            MemorySize: 2048,
            Timeout: 300,
            Handler: "index.testWorker",
            Runtime: "nodejs22.x",
            //Optional
            Description: "Test Description",
            Environment: {
              Variables: {
                TALIS_ENV_VAR: "some value",
                AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
              },
            },
            EphemeralStorage: {
              Size: 1024,
            },
            ReservedConcurrentExecutions: 10,
          },
        );
      });

      test("provisions a queue with the specified queueTimeout", () => {
        Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 2);

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-queue",
          VisibilityTimeout: 90,
        });

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-dlq",
          VisibilityTimeout: 90,
        });
      });
    });

    describe("with NodejsFunction props", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            memorySize: 2048,
            timeout: cdk.Duration.minutes(5),

            // NodejsFunction props
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            projectRoot: path.resolve(
              __dirname,
              "../../../examples/simple-lambda-worker",
            ),
            depsLockFilePath: "examples/simple-lambda-worker/package-lock.json",
            runtime: lambda.Runtime.NODEJS_20_X,
            awsSdkConnectionReuse: false,
            bundling: {
              minify: true,
            },
          },
          alarmTopic: alarmTopic,
        });
      });

      test("provisions a lambda", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        console.dir(Template.fromStack(stack).toJSON(), { depth: Infinity });

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            FunctionName: "MyTestLambdaWorker",
            MemorySize: 2048,
            Timeout: 300,
            Handler: "index.testWorker",
            Runtime: "nodejs20.x",
            Environment: { Variables: { LAMBDA_EXECUTION_TIMEOUT: "300" } },
          },
        );
      });
    });

    describe("given an optional topic", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });
        const topic = new sns.Topic(stack, "TestTopic", {
          topicName: "TestTopic",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
          subscription: {
            topic: topic,
          },
        });
      });

      test("subscribes to the topic", () => {
        Template.fromStack(stack).resourceCountIs("AWS::SNS::Subscription", 1);

        Template.fromStack(stack).hasResourceProperties(
          "AWS::SNS::Subscription",
          {
            Protocol: "sqs",
            TopicArn: {
              Ref: "TestTopic339EC197",
            },
            Endpoint: {
              "Fn::GetAtt": [
                "MyTestLambdaWorkerMyTestLambdaWorkerqueue01D6E79E",
                "Arn",
              ],
            },
          },
        );
      });
    });

    describe("disabling queue event source", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });
        const topic = new sns.Topic(stack, "TestTopic", {
          topicName: "TestTopic",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            enableQueue: false,
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
          subscription: {
            topic: topic,
          },
        });
      });

      test("provisions a lambda with disabled source", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);
        Template.fromStack(stack).resourceCountIs(
          "AWS::Lambda::EventSourceMapping",
          2,
        );

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::EventSourceMapping",
          {
            FunctionName: {
              Ref: "MyTestLambdaWorker107005A6",
            },
            Enabled: false,
            EventSourceArn: {
              "Fn::GetAtt": [
                "MyTestLambdaWorkerMyTestLambdaWorkerqueue01D6E79E",
                "Arn",
              ],
            },
          },
        );
      });
    });

    describe("enable queue event source defaults to true", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });
        const topic = new sns.Topic(stack, "TestTopic", {
          topicName: "TestTopic",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
          subscription: {
            topic: topic,
          },
        });
      });

      test("provisions a lambda with enabled source", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);
        Template.fromStack(stack).resourceCountIs(
          "AWS::Lambda::EventSourceMapping",
          2,
        );

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::EventSourceMapping",
          {
            FunctionName: {
              Ref: "MyTestLambdaWorker107005A6",
            },
            Enabled: true,
            EventSourceArn: {
              "Fn::GetAtt": [
                "MyTestLambdaWorkerMyTestLambdaWorkerqueue01D6E79E",
                "Arn",
              ],
            },
            ScalingConfig: {
              MaximumConcurrency: 5,
            },
          },
        );
      });
    });
  });

  describe("with fallbacks", () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      new LambdaWorker(stack, "MyTestLambdaWorker", {
        name: "MyTestLambdaWorker",
        lambdaProps: {
          queueMaxConcurrency: 5,
          entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
          handler: "testWorker",
          memorySize: 1024,
          ephemeralStorageSize: cdk.Size.mebibytes(1024),
          runtime: lambda.Runtime.NODEJS_22_X,
          timeout: cdk.Duration.minutes(5),
          retryAttempts: 2,
        },
        fallbacks: [
          { memorySize: 2048 },
          { memorySize: 4096, ephemeralStorageSize: cdk.Size.mebibytes(2048) },
        ],
        alarmTopic: alarmTopic,
      });
      template = Template.fromStack(stack);
    });

    test("provisions a lambda per tier, inheriting unspecified values", () => {
      template.resourceCountIs("AWS::Lambda::Function", 3);
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "MyTestLambdaWorker",
        MemorySize: 1024,
        EphemeralStorage: { Size: 1024 },
      });
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "MyTestLambdaWorker-01",
        MemorySize: 2048,
        EphemeralStorage: { Size: 1024 },
      });
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "MyTestLambdaWorker-02",
        MemorySize: 4096,
        EphemeralStorage: { Size: 2048 },
      });
    });

    test("sets retryAttempts to 1 on all but the last tier", () => {
      template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
        FunctionName: {
          Ref: stack.getLogicalId(findFunction("MyTestLambdaWorker")),
        },
        MaximumRetryAttempts: 1,
      });
      template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
        FunctionName: {
          Ref: stack.getLogicalId(findFunction("MyTestLambdaWorker-01")),
        },
        MaximumRetryAttempts: 1,
      });
      template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
        FunctionName: {
          Ref: stack.getLogicalId(findFunction("MyTestLambdaWorker-02")),
        },
        MaximumRetryAttempts: 2,
      });
    });

    test("chains each queue to the next tier's queue and the last to the DLQ", () => {
      template.resourceCountIs("AWS::SQS::Queue", 4);
      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "MyTestLambdaWorker-queue",
        RedrivePolicy: {
          deadLetterTargetArn: {
            "Fn::GetAtt": [findQueue("MyTestLambdaWorker-01-queue"), "Arn"],
          },
          maxReceiveCount: 5,
        },
      });
      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "MyTestLambdaWorker-01-queue",
        RedrivePolicy: {
          deadLetterTargetArn: {
            "Fn::GetAtt": [findQueue("MyTestLambdaWorker-02-queue"), "Arn"],
          },
        },
      });
      template.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "MyTestLambdaWorker-02-queue",
        RedrivePolicy: {
          deadLetterTargetArn: {
            "Fn::GetAtt": [findQueue("MyTestLambdaWorker-dlq"), "Arn"],
          },
        },
      });
    });

    test("triggers the last tier from the DLQ", () => {
      template.resourceCountIs("AWS::Lambda::EventSourceMapping", 4);
      template.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
        Enabled: false,
        EventSourceArn: {
          "Fn::GetAtt": [findQueue("MyTestLambdaWorker-dlq"), "Arn"],
        },
        FunctionName: {
          Ref: stack.getLogicalId(findFunction("MyTestLambdaWorker-02")),
        },
      });
    });

    function findQueue(queueName: string): string {
      const [id] = Object.keys(
        template.findResources("AWS::SQS::Queue", {
          Properties: { QueueName: queueName },
        }),
      );
      return id;
    }

    function findFunction(functionName: string): cdk.CfnElement {
      return stack.node
        .findAll()
        .find(
          (c) =>
            c instanceof lambda.CfnFunction && c.functionName === functionName,
        ) as cdk.CfnElement;
    }
  });

  describe("with fifo queue", () => {
    let stack: cdk.Stack;

    beforeAll(() => {
      const app = new cdk.App();
      stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      const vpc = new ec2.Vpc(stack, "TheVPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      });

      new LambdaWorker(stack, "MyTestLambdaWorker", {
        name: "MyTestLambdaWorker",
        lambdaProps: {
          queueMaxConcurrency: 5,
          entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
          handler: "testWorker",
          memorySize: 2048,
          policyStatements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sqs:*"],
              resources: ["*"],
            }),
          ],
          runtime: lambda.Runtime.NODEJS_22_X,
          timeout: cdk.Duration.minutes(5),
          vpc: vpc,
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        },
        queueProps: {
          fifo: true,
          contentBasedDeduplication: true,
        },
        alarmTopic: alarmTopic,
      });
    });

    test("provisions fifo SQS queue and dead letter queue", () => {
      Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 2);

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "MyTestLambdaWorker-queue.fifo",
        VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
        FifoQueue: true,
        ContentBasedDeduplication: true,
        RedrivePolicy: {
          maxReceiveCount: 5,
          deadLetterTargetArn: {
            "Fn::GetAtt": [
              "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
              "Arn",
            ],
          },
        },
      });

      Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
        QueueName: "MyTestLambdaWorker-dlq.fifo",
        VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
        FifoQueue: true,
        // ContentBasedDeduplication: true, // not set on the dlq. If it fails - we don't want it de duplicated for some reason.
      });
    });
  });

  describe("container lambda", () => {
    describe("with only required props", () => {
      let stack: cdk.Stack;
      let worker: LambdaWorker;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        worker = new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            dockerImageTag: "test-lambda-12345",
            ecrRepositoryArn: "arn:aws:ecr:eu-west-1:012345678910:repository",
            ecrRepositoryName: "repository",
            dockerCommand: "./src/script",
            memorySize: 2048,
            policyStatements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["sqs:*"],
                resources: ["*"],
              }),
            ],
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      });

      test("provisions a lambda", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            FunctionName: "MyTestLambdaWorker",
            ImageConfig: {
              Command: ["./src/script"],
            },
            MemorySize: 2048,
            Timeout: 300,
            Code: {
              ImageUri: {
                "Fn::Join": [
                  "",
                  [
                    "012345678910.dkr.ecr.eu-west-1.",
                    {
                      Ref: "AWS::URLSuffix",
                    },
                    `/repository:test-lambda-12345`,
                  ],
                ],
              },
            },
          },
        );
      });

      test.skip("exposes the sqs queue url and arn", () => {
        // This test does not work. In this test suite the construct has been created,
        // but the value of these properties are Tokens. e.g. "${Token[TOKEN.266]}"
        // See: https://github.com/aws/aws-cdk/issues/7258
        // And the reply it links to here: https://github.com/aws/aws-cdk/issues/7079#issuecomment-606394303
        // The tokens are not resolved into URL's until the `prepare` phase
        // This has not happened due to the way we are unit testing the constructs here.
        // We have a ticket to add integration tests for these constructs:
        // https://github.com/talis/platform/issues/5204
        // These will be tested in those integration tests.
        expect(worker.lambdaQueueUrl).toBe("expected url");
        expect(worker.lambdaQueueArn).toBe("expected arn");
      });

      test("provisions SQS queue and dead letter queue", () => {
        Template.fromStack(stack).resourceCountIs("AWS::SQS::Queue", 2);

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-queue",
          VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
          RedrivePolicy: {
            maxReceiveCount: 5,
            deadLetterTargetArn: {
              "Fn::GetAtt": [
                "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                "Arn",
              ],
            },
          },
        });

        Template.fromStack(stack).hasResourceProperties("AWS::SQS::Queue", {
          QueueName: "MyTestLambdaWorker-dlq",
          VisibilityTimeout: 1500, // 5 (default max receive count) * 300 (lambda timeout)
        });
      });

      test("provisions three alarms", () => {
        Template.fromStack(stack).resourceCountIs("AWS::CloudWatch::Alarm", 3);
      });

      test("provisions a message visible alarm on the dead letter queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-dlq-messages-visible-alarm",
            AlarmDescription:
              "Alarm when the lambda worker fails to process a message and the message appears on the DLQ",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateNumberOfMessagesVisible",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Sum",
            Threshold: 1,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });

      test("provisions a message visible alarm on the main queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-queue-messages-visible-alarm",
            AlarmDescription:
              "Alarm when the lambda workers main trigger queue has more than 1000 messages on the queue",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateNumberOfMessagesVisible",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerdlq27BBFD95",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Sum",
            Threshold: 1000,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });

      test("provisions an age of oldest message alarm on the main queue", () => {
        Template.fromStack(stack).hasResourceProperties(
          "AWS::CloudWatch::Alarm",
          {
            AlarmName: "MyTestLambdaWorker-queue-message-age-alarm",
            AlarmDescription:
              "Alarm when the lambda workers main trigger queue has messages older than 3600 seconds",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateAgeOfOldestMessage",
            Dimensions: [
              {
                Name: "QueueName",
                Value: {
                  "Fn::GetAtt": [
                    "MyTestLambdaWorkerMyTestLambdaWorkerqueue01D6E79E",
                    "QueueName",
                  ],
                },
              },
            ],
            Period: 60,
            Statistic: "Average",
            Threshold: 3600,
            ComparisonOperator: "GreaterThanOrEqualToThreshold",
            TreatMissingData: "ignore",
            OKActions: [{ Ref: "TestAlarm5A9EF6BD" }],
          },
        );
      });
    });

    describe("with no command specified", () => {
      let stack: cdk.Stack;

      beforeAll(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            dockerImageTag: "test-lambda-12345",
            ecrRepositoryArn: "arn:aws:ecr:eu-west-1:012345678910:repository",
            ecrRepositoryName: "repository",
            // dockerCommand: "./src/script", Intentionally removed
            memorySize: 2048,
            policyStatements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["sqs:*"],
                resources: ["*"],
              }),
            ],
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      });

      test("provisions a lambda", () => {
        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            FunctionName: "MyTestLambdaWorker",
            // Command removed. There doesn't seem to be a way to verify that properties do not exist.
            //
            // ImageConfig: {
            //   "Command": [
            //     "./src/script"
            //   ]
            // },
            MemorySize: 2048,
            Timeout: 300,
            Code: {
              ImageUri: {
                "Fn::Join": [
                  "",
                  [
                    "012345678910.dkr.ecr.eu-west-1.",
                    {
                      Ref: "AWS::URLSuffix",
                    },
                    `/repository:test-lambda-12345`,
                  ],
                ],
              },
            },
          },
        );
      });
    });

    describe("from image asset", () => {
      let stack: cdk.Stack;
      let alarmTopic: sns.Topic;
      let lambdaProps: LambdaWorkerProps["lambdaProps"];

      beforeEach(() => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, "TestStack");
        alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        lambdaProps = {
          queueMaxConcurrency: 5,
          memorySize: 2048,
          policyStatements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ["sqs:*"],
              resources: ["*"],
            }),
          ],
          timeout: cdk.Duration.minutes(5),
          vpc: new ec2.Vpc(stack, "TheVPC", {
            ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
          }),
          vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        };
      });

      test("builds an image from directory", () => {
        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            ...lambdaProps,
            imageAsset: {
              directory: "./test/infra/lambda-worker/image-assets1",
            },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });

        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        // TODO: IS this image uri not going to keep changing?
        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            PackageType: "Image",
            Code: {
              ImageUri: {
                "Fn::Sub":
                  "${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/cdk-hnb659fds-container-assets-${AWS::AccountId}-${AWS::Region}:4cf46eba6932d8b82d75ff231d64f6eb5c2c8a5b843e7100222cab515bd5e5f2",
              },
            },
          },
        );
      });

      test("builds an image with asset props", () => {
        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            ...lambdaProps,
            imageAsset: {
              directory: "./test/infra/lambda-worker/image-assets2",
              props: {
                buildArgs: {
                  TEST_ARG: "test",
                },
                file: "my.Dockerfile",
                cmd: ["app.handler"],
              },
            },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });

        Template.fromStack(stack).resourceCountIs("AWS::Lambda::Function", 1);

        // TODO: IS this image uri not going to keep changing?
        Template.fromStack(stack).hasResourceProperties(
          "AWS::Lambda::Function",
          {
            PackageType: "Image",
            Code: {
              ImageUri: {
                "Fn::Sub":
                  "${AWS::AccountId}.dkr.ecr.${AWS::Region}.${AWS::URLSuffix}/cdk-hnb659fds-container-assets-${AWS::AccountId}-${AWS::Region}:752308ac702b0693e5a4d833bf88b14ed00bb217f0c168b8a645051d1c8a3274",
              },
            },
            ImageConfig: {
              Command: ["app.handler"],
            },
          },
        );
      });
    });
  });

  describe("when the lambda timeout is shorter than the minimum ", () => {
    test("throws an exception", () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      const vpc = new ec2.Vpc(stack, "TheVPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      });

      expect(() => {
        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 2048,
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.seconds(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      }).toThrow("Invalid lambdaProps.timeout value of 5. Minimum value is 30");
    });
  });

  describe("when memory size is smaller than the minimum ", () => {
    test("throws an exception", () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, "TestStack");
      const alarmTopic = new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      const vpc = new ec2.Vpc(stack, "TheVPC", {
        ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      });

      expect(() => {
        new LambdaWorker(stack, "MyTestLambdaWorker", {
          name: "MyTestLambdaWorker",
          lambdaProps: {
            queueMaxConcurrency: 5,
            entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
            handler: "testWorker",
            memorySize: 512,
            runtime: lambda.Runtime.NODEJS_22_X,
            timeout: cdk.Duration.minutes(5),
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          },
          queueProps: {},
          alarmTopic: alarmTopic,
        });
      }).toThrow(
        "Invalid lambdaProps.memorySize value of 512. Minimum value is 1024",
      );
    });
  });

  describe("when dockerImageTag/ecrRepositoryArn/ecrRepositoryName and handler/entry are specified", () => {
    const cases = [
      {
        description: "throws an exception when all are specified",
        dockerCommand: "./src/example",
        dockerImageTag: "test-image-12345",
        ecrRepositoryArn: "arn:aws:ecr:eu-west-1:012345678910:repository/test",
        ecrRepositoryName: "repository",
        handler: "testWorker",
        entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
      },
      {
        description: "throws an exception when none are specified",
        dockerCommand: undefined,
        dockerImageTag: undefined,
        ecrRepositoryArn: undefined,
        ecrRepositoryName: undefined,
        handler: undefined,
        entry: undefined,
      },
      {
        description: "throws an exception when only handler is specified",
        dockerCommand: undefined,
        dockerImageTag: undefined,
        ecrRepositoryArn: undefined,
        ecrRepositoryName: undefined,
        handler: "testWorker",
        entry: undefined,
      },
      {
        description: "throws an exception when only entry is specified",
        dockerCommand: undefined,
        dockerImageTag: undefined,
        ecrRepositoryArn: undefined,
        ecrRepositoryName: undefined,
        handler: undefined,
        entry: "examples/simple-lambda-worker/src/lambda/simple-worker.js",
      },
      {
        description:
          "throws an exception when only dockerImageTag is specified",
        dockerCommand: undefined,
        dockerImageTag: "test-lambda-12345",
        ecrRepositoryArn: undefined,
        ecrRepositoryName: undefined,
        handler: undefined,
        entry: undefined,
      },
      {
        description:
          "throws an exception when only ecrRepositoryArn is specified",
        dockerCommand: undefined,
        dockerImageTag: undefined,
        ecrRepositoryArn: "arn:aws:ecr:eu-west-1:012345678910:repository/test",
        handler: undefined,
        entry: undefined,
      },
      {
        description:
          "throws an exception when only ecrRepositoryName is specified",
        dockerCommand: undefined,
        dockerImageTag: undefined,
        ecrRepositoryArn: undefined,
        ecrRepositoryName: "repository",
        handler: undefined,
        entry: undefined,
      },
      {
        description: "throws an exception when only dockerCommand is specified",
        dockerCommand: "src/example",
        dockerImageTag: undefined,
        ecrRepositoryArn: undefined,
        ecrRepositoryName: undefined,
        handler: undefined,
        entry: undefined,
      },
    ];

    cases.forEach((config) => {
      test(config.description, () => {
        const app = new cdk.App();
        const stack = new cdk.Stack(app, "TestStack");
        const alarmTopic = new sns.Topic(stack, "TestAlarm", {
          topicName: "TestAlarm",
        });

        const vpc = new ec2.Vpc(stack, "TheVPC", {
          ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
        });

        expect(() => {
          new LambdaWorker(stack, "MyTestLambdaWorker", {
            name: "MyTestLambdaWorker",
            lambdaProps: {
              queueMaxConcurrency: 5,
              entry: config.entry,
              handler: config.handler,
              dockerCommand: config.dockerCommand,
              dockerImageTag: config.dockerImageTag,
              ecrRepositoryArn: config.ecrRepositoryArn,
              ecrRepositoryName: config.ecrRepositoryName,
              memorySize: 2048,
              runtime: lambda.Runtime.NODEJS_22_X,
              timeout: cdk.Duration.minutes(5),
              vpc: vpc,
              vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            },
            queueProps: {},
            alarmTopic: alarmTopic,
          });
        }).toThrow(
          "Invalid lambdaProps only dockerImageTag/ecrRepositoryArn/ecrRepositoryName or handler/entry can be specified.",
        );
      });
    });
  });
});
