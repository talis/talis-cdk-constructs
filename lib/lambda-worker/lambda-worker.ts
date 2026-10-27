import * as cdk from "aws-cdk-lib";
import { aws_ecr as ecr } from "aws-cdk-lib";
import { aws_sns_subscriptions as subs } from "aws-cdk-lib";
import { aws_sqs as sqs } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { aws_cloudwatch_actions as cloudwatchActions } from "aws-cdk-lib";
import { aws_lambda_nodejs as lambdaNodeJs } from "aws-cdk-lib";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";

import {
  ContainerFromEcrLambdaProps,
  LambdaWorkerProps,
} from "./lambda-worker-props";
import { buildLambdaEnvironment } from "../util/build-lambda-environment";

const DEFAULT_MAX_RECEIVE_COUNT = 5;
const DEFAULT_APPROX_AGE_OLDEST_MESSAGE_THRESHOLD = cdk.Duration.hours(1);
const DEFAULT_APPROX_NUM_MESSAGES_VISIBLE_THRESHOLD = 1000;
const MINIMUM_MEMORY_SIZE = 1024;
const MINIMUM_LAMBDA_TIMEOUT = cdk.Duration.seconds(30);

export class LambdaWorker extends Construct {
  // The ARN of the queue messages for this LambdaWorker to process
  // should be placed on.
  public lambdaQueueArn: string;

  // The URL of the queue messages for this LambdaWorker to process
  // should be placed on. If you have passed in an option subscrip topic,
  // this queue will have automatically been subscribed to that topic.
  // If you have not supplied a topic, then you will need to route
  // messages to the queue at lambdaQueueUrl.
  public lambdaQueueUrl: string;

  // Expose a reference to the SQS queue that this LambdaWorker
  // Obtaining a reference to the queue using the ARN exposed above
  // allows for an unmodifiable reference to the queue to be obtained using
  // findByArn. Direct access to the queue is provided to allow modification
  // of the queue, for example for EventBridge iam permissions.
  public readonly lambdaQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: LambdaWorkerProps) {
    super(scope, id);

    // Lambda settings
    if (props.lambdaProps.memorySize < MINIMUM_MEMORY_SIZE) {
      throw new Error(
        `Invalid lambdaProps.memorySize value of ${props.lambdaProps.memorySize}. Minimum value is ${MINIMUM_MEMORY_SIZE}`,
      );
    }

    if (
      props.lambdaProps.timeout.toSeconds() < MINIMUM_LAMBDA_TIMEOUT.toSeconds()
    ) {
      throw new Error(
        `Invalid lambdaProps.timeout value of ${props.lambdaProps.timeout.toSeconds()}. Minimum value is ${MINIMUM_LAMBDA_TIMEOUT.toSeconds()}`,
      );
    }

    if (!this.isContainerLambda(props) && !this.isFunctionLambda(props)) {
      throw new Error(
        `Invalid lambdaProps only dockerImageTag/ecrRepositoryArn/ecrRepositoryName or handler/entry can be specified.`,
      );
    }

    // Queue settings
    const maxReceiveCount =
      props.queueProps && props.queueProps.maxReceiveCount
        ? props.queueProps.maxReceiveCount
        : DEFAULT_MAX_RECEIVE_COUNT;

    const queueTimeout = props.lambdaProps.queueTimeout
      ? props.lambdaProps.queueTimeout
      : cdk.Duration.seconds(
          maxReceiveCount * props.lambdaProps.timeout.toSeconds(),
        );

    const approximateAgeOfOldestMessageThreshold =
      props.queueProps &&
      props.queueProps.approximateAgeOfOldestMessageThreshold
        ? props.queueProps.approximateAgeOfOldestMessageThreshold
        : DEFAULT_APPROX_AGE_OLDEST_MESSAGE_THRESHOLD;

    const approximateNumberOfMessagesVisibleThreshold =
      props.queueProps &&
      props.queueProps.approximateNumberOfMessagesVisibleThreshold
        ? props.queueProps.approximateNumberOfMessagesVisibleThreshold
        : DEFAULT_APPROX_NUM_MESSAGES_VISIBLE_THRESHOLD;

    const fifo = this.isFifo(props);

    // One lambda + queue per tier: the default, then each fallback.
    // A tier's queue dead-letters to the next tier's queue; the last one to the DLQ.
    const fallbacks = props.fallbacks ?? [];
    for (const fallback of fallbacks) {
      if (fallback.memorySize && fallback.memorySize < MINIMUM_MEMORY_SIZE) {
        throw new Error(
          `Invalid fallbacks.memorySize value of ${fallback.memorySize}. Minimum value is ${MINIMUM_MEMORY_SIZE}`,
        );
      }
    }
    const tiers: LambdaWorkerProps[] = [{}, ...fallbacks].map(
      (overrides, tierIndex) => ({
        ...props,
        name:
          tierIndex === 0
            ? props.name
            : `${props.name}-${String(tierIndex).padStart(2, "0")}`,
        lambdaProps: {
          ...props.lambdaProps,
          ...overrides,
          // All but the last tier hand the job on instead of retrying
          retryAttempts:
            tierIndex < fallbacks.length ? 1 : props.lambdaProps.retryAttempts,
        },
      }),
    );

    // Create both the main queue and the dead letter queue
    let dlqName = `${props.name}-dlq`;
    if (fifo) {
      dlqName = `${dlqName}.fifo`;
    }
    const lambdaDLQ = new sqs.Queue(this, `${props.name}-dlq`, {
      queueName: dlqName,
      visibilityTimeout: queueTimeout,
      retentionPeriod: cdk.Duration.days(14),
      fifo: fifo ? true : undefined, // This is required for fifo, but has to be undefined not flase for non-fifo
    });

    const queues: sqs.Queue[] = [];
    let deadLetterQueue = lambdaDLQ;
    for (const tier of [...tiers].reverse()) {
      let queueName = `${tier.name}-queue`;
      if (fifo) {
        queueName = `${queueName}.fifo`;
      }
      deadLetterQueue = new sqs.Queue(this, `${tier.name}-queue`, {
        queueName,
        visibilityTimeout: queueTimeout,
        retentionPeriod: cdk.Duration.days(14),
        deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount },
        fifo: fifo ? true : undefined, // This is required for fifo, but has to be undefined not flase for non-fifo
        contentBasedDeduplication:
          props.queueProps && props.queueProps.contentBasedDeduplication
            ? props.queueProps.contentBasedDeduplication
            : undefined,
      });
      queues.unshift(deadLetterQueue);
    }
    this.lambdaQueue = queues[0];
    this.lambdaQueueUrl = this.lambdaQueue.queueUrl;
    this.lambdaQueueArn = this.lambdaQueue.queueArn;

    // If we have specified a topic, then subscribe
    // the main queue to the topic.
    if (props.subscription && props.subscription.topic) {
      // Topic Subscription Settings
      let subscriptionProps = {};
      if (props.subscription.filterPolicy) {
        subscriptionProps = { filterPolicy: props.subscription.filterPolicy };
      }

      props.subscription.topic.addSubscription(
        new subs.SqsSubscription(this.lambdaQueue, subscriptionProps),
      );
    }

    // Create the lambdas
    tiers.forEach((tier, tierIndex) => {
      const lambdaWorker: lambda.Function = this.createLambdaFunction(tier);

      if (props.lambdaProps.policyStatements) {
        for (const statement of props.lambdaProps.policyStatements) {
          // Changed to addToPrincipalPolicy - is this correct?
          lambdaWorker.role?.addToPrincipalPolicy(statement);
        }
      }

      // Each tier consumes its own queue. The last tier also gets the DLQ
      // as a disabled event source so failed jobs can be replayed.
      lambdaWorker.addEventSource(
        new SqsEventSource(queues[tierIndex], {
          enabled: props.lambdaProps.enableQueue ?? true,
          batchSize: 1,
          maxConcurrency: props.lambdaProps.queueMaxConcurrency,
        }),
      );
      if (tierIndex === tiers.length - 1) {
        lambdaWorker.addEventSource(
          new SqsEventSource(lambdaDLQ, {
            enabled: false,
            batchSize: 1,
            maxConcurrency: props.lambdaProps.queueMaxConcurrency,
          }),
        );
      }
    });

    // Add alerting

    const alarmAction = new cloudwatchActions.SnsAction(props.alarmTopic);

    // Add an alarm on any messages appearing on the DLQ
    const approximateNumberOfMessagesVisibleMetric = lambdaDLQ
      .metric("ApproximateNumberOfMessagesVisible")
      .with({
        statistic: "sum",
        period: cdk.Duration.minutes(1),
      });
    const dlqMessagesVisable = new cloudwatch.Alarm(
      this,
      `${props.name}-dlq-messages-visible-alarm`,
      {
        alarmName: `${props.name}-dlq-messages-visible-alarm`,
        alarmDescription: `Alarm when the lambda worker fails to process a message and the message appears on the DLQ`,
        actionsEnabled: true,
        metric: approximateNumberOfMessagesVisibleMetric,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    );
    dlqMessagesVisable.addAlarmAction(alarmAction);
    dlqMessagesVisable.addOkAction(alarmAction);

    // Add an alarm for the age of the oldest message on the LambdaWorkers main trigger queue
    const approximateAgeOfOldestMessageMetric = this.lambdaQueue
      .metric("ApproximateAgeOfOldestMessage")
      .with({ statistic: "average", period: cdk.Duration.minutes(1) });
    const queueMessagesAge = new cloudwatch.Alarm(
      this,
      `${props.name}-queue-message-age-alarm`,
      {
        alarmName: `${props.name}-queue-message-age-alarm`,
        alarmDescription: `Alarm when the lambda workers main trigger queue has messages older than ${approximateAgeOfOldestMessageThreshold.toSeconds()} seconds`,
        actionsEnabled: true,
        metric: approximateAgeOfOldestMessageMetric,
        evaluationPeriods: 1,
        threshold: approximateAgeOfOldestMessageThreshold.toSeconds(),
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    );
    queueMessagesAge.addAlarmAction(alarmAction);
    queueMessagesAge.addOkAction(alarmAction);

    // Add an alarm for more than "approximateNumberOfMessagesVisible" messages on the queue
    const queueMessagesVisable = new cloudwatch.Alarm(
      this,
      `${props.name}-queue-messages-visible-alarm`,
      {
        alarmName: `${props.name}-queue-messages-visible-alarm`,
        alarmDescription: `Alarm when the lambda workers main trigger queue has more than ${approximateNumberOfMessagesVisibleThreshold} messages on the queue`,
        actionsEnabled: true,
        metric: approximateNumberOfMessagesVisibleMetric,
        evaluationPeriods: 1,
        threshold: approximateNumberOfMessagesVisibleThreshold,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    );
    queueMessagesVisable.addAlarmAction(alarmAction);
    queueMessagesVisable.addOkAction(alarmAction);
  }

  isContainerLambda(props: LambdaWorkerProps): boolean {
    return (
      this.hasContainerLambdaProps(props) && !this.hasFunctionLambdaProps(props)
    );
  }

  isFunctionLambda(props: LambdaWorkerProps): boolean {
    return (
      this.hasFunctionLambdaProps(props) && !this.hasContainerLambdaProps(props)
    );
  }

  isFifo(props: LambdaWorkerProps): boolean {
    if (props.queueProps && props.queueProps.fifo === true) {
      return true;
    }
    return false;
  }

  createLambdaFunction(props: LambdaWorkerProps): lambda.Function {
    if (this.isContainerLambda(props)) {
      return this.createContainerLambdaFunction(props);
    }

    return this.createNodejsLambdaFunction(props);
  }

  private hasContainerLambdaProps(props: LambdaWorkerProps): boolean {
    return Boolean(
      props.lambdaProps.imageAsset ||
        (props.lambdaProps.dockerImageTag &&
          props.lambdaProps.ecrRepositoryArn &&
          props.lambdaProps.ecrRepositoryName),
    );
  }

  private hasFunctionLambdaProps(props: LambdaWorkerProps): boolean {
    return Boolean(
      props.lambdaProps.entry &&
        props.lambdaProps.handler &&
        props.lambdaProps.runtime,
    );
  }

  private createNodejsLambdaFunction(
    props: LambdaWorkerProps,
  ): lambda.Function {
    return new lambdaNodeJs.NodejsFunction(this, props.name, {
      functionName: props.name,

      // Pass through props from lambda props object
      // Documented here https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda-nodejs.NodejsFunctionProps.html
      description: props.lambdaProps.description,
      environment: buildLambdaEnvironment({
        environment: props.lambdaProps.environment,
        timeout: props.lambdaProps.timeout,
      }),
      ephemeralStorageSize: props.lambdaProps.ephemeralStorageSize,
      memorySize: props.lambdaProps.memorySize,
      reservedConcurrentExecutions:
        props.lambdaProps.reservedConcurrentExecutions,
      retryAttempts: props.lambdaProps.retryAttempts,
      securityGroups: props.lambdaProps.securityGroups,
      timeout: props.lambdaProps.timeout,
      vpc: props.lambdaProps.vpc,
      vpcSubnets: props.lambdaProps.vpcSubnets,
      filesystem: props.lambdaProps.filesystem,

      // NodejsFunction-only props
      entry: props.lambdaProps.entry,
      handler: props.lambdaProps.handler,
      runtime: props.lambdaProps.runtime,
      awsSdkConnectionReuse: props.lambdaProps.awsSdkConnectionReuse ?? true,
      depsLockFilePath: props.lambdaProps.depsLockFilePath,
      bundling: props.lambdaProps.bundling,
      projectRoot: props.lambdaProps.projectRoot,
    });
  }

  private createContainerLambdaFunction(
    props: LambdaWorkerProps,
  ): lambda.Function {
    return new lambda.DockerImageFunction(this, props.name, {
      code: this.getContainerLambdaCode(props),
      functionName: props.name,
      description: props.lambdaProps.description,
      environment: buildLambdaEnvironment({
        environment: props.lambdaProps.environment,
        timeout: props.lambdaProps.timeout,
      }),
      ephemeralStorageSize: props.lambdaProps.ephemeralStorageSize,
      memorySize: props.lambdaProps.memorySize,
      reservedConcurrentExecutions:
        props.lambdaProps.reservedConcurrentExecutions,
      retryAttempts: props.lambdaProps.retryAttempts,
      securityGroups: props.lambdaProps.securityGroups,
      timeout: props.lambdaProps.timeout,
      filesystem: props.lambdaProps.filesystem,
      vpc: props.lambdaProps.vpc,
      vpcSubnets: props.lambdaProps.vpcSubnets,
    });
  }

  private getContainerLambdaCode(
    props: LambdaWorkerProps,
  ): lambda.DockerImageCode {
    if (props.lambdaProps.imageAsset) {
      return lambda.DockerImageCode.fromImageAsset(
        props.lambdaProps.imageAsset.directory,
        props.lambdaProps.imageAsset.props,
      );
    }

    const containerProps = props.lambdaProps as ContainerFromEcrLambdaProps;

    const ecrRepository: ecr.IRepository =
      ecr.Repository.fromRepositoryAttributes(this, `${props.name}-ecr`, {
        repositoryArn: containerProps.ecrRepositoryArn,
        repositoryName: containerProps.ecrRepositoryName,
      });

    let dockerImageCodeProps: lambda.EcrImageCodeProps = {
      tagOrDigest: containerProps.dockerImageTag,
    };

    // Only set the command on props if there is one.
    // Setting an empty string causes errors when using the default command
    if (containerProps.dockerCommand) {
      dockerImageCodeProps = {
        tagOrDigest: containerProps.dockerImageTag,
        cmd: [containerProps.dockerCommand],
      };
    }

    return lambda.DockerImageCode.fromEcr(ecrRepository, dockerImageCodeProps);
  }
}
