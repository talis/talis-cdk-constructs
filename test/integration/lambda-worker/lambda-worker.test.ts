import { SQS } from "@aws-sdk/client-sqs";
import { randomUUID } from "node:crypto";

const sqs = new SQS();

const JOB_WHICH_WILL_SUCCEED = { result: "SUCCESS" };
const JOB_WHICH_WILL_FAIL = { result: "FAIL" };

// waitForQueueSizeToBe will check queue size every 5 seconds, making a maximum of 20 checks before failing
const WATCH_CHECK_PERIOD = 5000;
const WATCH_ATTEMPTS = 20;

describe("LambdaWorker", () => {
  // Increase the timeout We are sending messages and waiting for lambda's to run
  vi.setConfig({ testTimeout: 350000, hookTimeout: 350000 });

  let workerSqsUrl: string;
  let successSqsUrl: string;
  let dlqSqsUrl: string;

  async function findQueueUrl(queuePostfix: string): Promise<string> {
    const queueName = `${process.env.AWS_PREFIX}${queuePostfix}`;
    // Filter by name: an unfiltered listQueues returns at most 1000 queues
    const response = await sqs.listQueues({ QueueNamePrefix: queueName });

    const queueUrl = response.QueueUrls?.find((url) =>
      url.endsWith(`/${queueName}`),
    );
    if (!queueUrl) {
      throw Error(`Worker queue ${queueName} not found`);
    }
    return queueUrl;
  }

  async function sendJob(message: object) {
    const params = {
      QueueUrl: workerSqsUrl,
      MessageDeduplicationId: randomUUID(),
      MessageGroupId: "1",
      MessageBody: JSON.stringify(message),
    };
    await sqs.sendMessage(params);
  }

  async function queueSize(queueUrl: string): Promise<number> {
    const response = await sqs.getQueueAttributes({
      QueueUrl: queueUrl,
      AttributeNames: ["ApproximateNumberOfMessages"],
    });
    const size = response.Attributes?.ApproximateNumberOfMessages;
    if (size === undefined) {
      throw Error("Unable to determine size of queue");
    }
    return +size;
  }

  async function waitForQueueSizeToBe(queueUrl: string, expectedSize: number) {
    let currentAttempt = 1;

    while (currentAttempt++ <= WATCH_ATTEMPTS) {
      const currentSize = await queueSize(queueUrl);
      if (currentSize === expectedSize) {
        return;
      } else if (currentSize > expectedSize) {
        throw Error(
          `Looking for ${expectedSize} messages on ${queueUrl} But there are already ${currentSize}.`,
        );
      } else {
        await sleep(WATCH_CHECK_PERIOD);
      }
    }

    const finalSize = await queueSize(queueUrl);
    throw Error(
      `Looking for ${expectedSize} messages on ${queueUrl}. But there are only ${finalSize}`,
    );
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  beforeAll(async () => {
    workerSqsUrl = await findQueueUrl("simple-lambda-worker-queue.fifo");
    dlqSqsUrl = await findQueueUrl("simple-lambda-worker-dlq.fifo");
    successSqsUrl = await findQueueUrl("simple-lambda-worker-success");
  });

  beforeEach(async () => {
    console.log("Purging queues...");
    await sqs.purgeQueue({ QueueUrl: workerSqsUrl });
    await sqs.purgeQueue({ QueueUrl: dlqSqsUrl });
    await sqs.purgeQueue({ QueueUrl: successSqsUrl });

    console.log("Waiting for purge to take affect....");
    // You are only allowed one purge every 60 seconds - reducing this will cause failures.
    // The purge is what is making this test reliable, but this pattern of a 60 second
    // pause between tests is not a good one. It adds one minute to the build for every test
    // written below. Do not copy unlesss necessary and consider this when adding more tests here.
    await sleep(60000);

    console.log("Checking queue sizes are zero before starting test");
    await waitForQueueSizeToBe(successSqsUrl, 0);
    await waitForQueueSizeToBe(dlqSqsUrl, 0);
    console.log("Queues sizes are zero.");
  });

  test("successfully processes messages", async () => {
    sendJob(JOB_WHICH_WILL_SUCCEED);
    await waitForQueueSizeToBe(successSqsUrl, 1);
    await waitForQueueSizeToBe(dlqSqsUrl, 0);
  });

  test("failed messages go to the dlq", async () => {
    sendJob(JOB_WHICH_WILL_FAIL);
    await waitForQueueSizeToBe(dlqSqsUrl, 1);
    await waitForQueueSizeToBe(successSqsUrl, 0);
  });
});
