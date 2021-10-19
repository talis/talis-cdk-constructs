import * as cdk from "@aws-cdk/core";
import * as cloudwatch from "@aws-cdk/aws-cloudwatch";
import * as cloudwatchActions from "@aws-cdk/aws-cloudwatch-actions";
import * as eventSource from "@aws-cdk/aws-lambda-event-sources";
import * as lambda from "@aws-cdk/aws-lambda";
import * as lambdaNodeJs from "@aws-cdk/aws-lambda-nodejs";
import * as sqs from "@aws-cdk/aws-sqs";
import * as subs from "@aws-cdk/aws-sns-subscriptions";

import { LambdaWorkerProps } from "./lambda-worker-props";

const DEFAULT_MAX_RECEIVE_COUNT = 5;
const DEFAULT_APPROX_AGE_OLDEST_MESSAGE_THRESHOLD = cdk.Duration.hours(1);
const DEFAULT_APPROX_NUM_MESSAGES_VISIBLE_THRESHOLD = 1000;
const MINIMUM_MEMORY_SIZE = 1024;
const MINIMUM_LAMBDA_TIMEOUT = cdk.Duration.seconds(30);

export class LambdaWorker extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: LambdaWorkerProps) {
    super(scope, id);

    // Lambda settings
    if (props.lambdaProps.memorySize < MINIMUM_MEMORY_SIZE) {
      throw new Error(
        `Invalid lambdaProps.memorySize value of ${props.lambdaProps.memorySize}. Minimum value is ${MINIMUM_MEMORY_SIZE}`
      );
    }

    if (
      props.lambdaProps.timeout.toSeconds() < MINIMUM_LAMBDA_TIMEOUT.toSeconds()
    ) {
      throw new Error(
        `Invalid lambdaProps.timeout value of ${props.lambdaProps.timeout.toSeconds()}. Minimum value is ${MINIMUM_LAMBDA_TIMEOUT.toSeconds()}`
      );
    }

    // Queue settings
    const maxReceiveCount =
      props.queueProps && props.queueProps.maxReceiveCount
        ? props.queueProps.maxReceiveCount
        : DEFAULT_MAX_RECEIVE_COUNT;

    const queueTimeout = cdk.Duration.seconds(
      maxReceiveCount * props.lambdaProps.timeout.toSeconds()
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

    // Create both the main queue and the dead letter queue
    const lambdaDLQ = new sqs.Queue(this, `${props.name}-dlq`, {
      queueName: `${props.name}-dlq`,
      visibilityTimeout: queueTimeout,
    });

    const lambdaQueue = new sqs.Queue(this, `${props.name}-queue`, {
      queueName: `${props.name}-queue`,
      visibilityTimeout: queueTimeout,
      deadLetterQueue: { queue: lambdaDLQ, maxReceiveCount: maxReceiveCount },
    });

    // If we have specified a topic, then subscribe
    // the main queue to the topic.
    if (props.subscription && props.subscription.topic) {
      // Topic Subscription Settings
      let subscriptionProps = {};
      if (props.subscription.filterPolicy) {
        subscriptionProps = { filterPolicy: props.subscription.filterPolicy };
      }

      props.subscription.topic.addSubscription(
        new subs.SqsSubscription(lambdaQueue, subscriptionProps)
      );
    }

    // Create the lambda
    const lambdaWorker = new lambdaNodeJs.NodejsFunction(this, props.name, {
      functionName: props.name,

      // Pass through props from lambda props object
      // Documented here https://docs.aws.amazon.com/cdk/api/latest/docs/@aws-cdk_aws-lambda-nodejs.NodejsFunctionProps.html
      entry: props.lambdaProps.entry,
      handler: props.lambdaProps.handler,
      description: props.lambdaProps.description,
      environment: props.lambdaProps.environment,
      memorySize: props.lambdaProps.memorySize,
      reservedConcurrentExecutions:
        props.lambdaProps.reservedConcurrentExecutions,
      retryAttempts: props.lambdaProps.retryAttempts,
      role: props.lambdaProps.role,
      securityGroup: props.lambdaProps.securityGroup,
      timeout: props.lambdaProps.timeout,
      vpc: props.lambdaProps.vpc,
      vpcSubnets: props.lambdaProps.vpcSubnets,

      // Enforce the following properties
      awsSdkConnectionReuse: true,
      runtime: lambda.Runtime.NODEJS_14_X,
    });

    // Add main queue and DLQ as event sources to the lambda
    // By default, the main queue is enabled and the DLQ is disabled
    lambdaWorker.addEventSource(
      new eventSource.SqsEventSource(lambdaQueue, { enabled: true })
    );
    lambdaWorker.addEventSource(
      new eventSource.SqsEventSource(lambdaDLQ, { enabled: false })
    );

    // Add alerting

    const alarmAction = new cloudwatchActions.SnsAction(props.alarmTopic);

    // Add an alarm on any messages appearing on the DLQ
    const approximateNumberOfMessagesVisibleMetric = lambdaDLQ.metric(
      "ApproximateNumberOfMessagesVisible"
    );
    const dlqMessagesVisable = new cloudwatch.Alarm(
      this,
      `${props.name}-dlq-messages-visible-alarm`,
      {
        alarmName: `${props.name}-dlq-messages-visible-alarm`,
        alarmDescription: `Alarm when the lambda worker fails to process a message and the message appears on the DLQ`,
        actionsEnabled: true,
        metric: approximateNumberOfMessagesVisibleMetric,
        statistic: "sum",
        period: cdk.Duration.minutes(1),
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      }
    );
    dlqMessagesVisable.addAlarmAction(alarmAction);
    dlqMessagesVisable.addOkAction(alarmAction);

    // Add an alarm for the age of the oldest message on the LambdaWorkers main trigger queue
    const approximateAgeOfOldestMessageMetric = lambdaDLQ.metric(
      "ApproximateAgeOfOldestMessage"
    );
    const queueMessagesAge = new cloudwatch.Alarm(
      this,
      `${props.name}-queue-message-age-alarm`,
      {
        alarmName: `${props.name}-queue-message-age-alarm`,
        alarmDescription: `Alarm when the lambda workers main trigger queue has messages older than ${approximateAgeOfOldestMessageThreshold.toSeconds()} seconds`,
        actionsEnabled: true,
        metric: approximateAgeOfOldestMessageMetric,
        statistic: "average",
        period: cdk.Duration.minutes(1),
        evaluationPeriods: 1,
        threshold: approximateAgeOfOldestMessageThreshold.toSeconds(),
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      }
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
        statistic: "sum",
        period: cdk.Duration.minutes(1),
        evaluationPeriods: 1,
        threshold: approximateNumberOfMessagesVisibleThreshold,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        // Set treatMissingData to IGNORE
        // Stops alarms with minimal data having false alarms when they transition to this state
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      }
    );
    queueMessagesVisable.addAlarmAction(alarmAction);
    queueMessagesVisable.addOkAction(alarmAction);
  }
}
