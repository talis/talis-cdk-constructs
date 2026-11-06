const { SQS } = require("@aws-sdk/client-sqs");

const sqs = new SQS();
const successSqsUrl = process.env.SUCCESS_QUEUE_URL;

class SimpleLambdaWorker {
  constructor(event) {
    this.event = event;
  }

  async handle() {
    console.log(
      `Simple Worker processing event: ${JSON.stringify(this.event)}`,
    );

    const message = this.event.Records[0];
    const { result } = JSON.parse(message.body);
    console.log(`Result: ${result}`);

    if (result === "FAIL") {
      throw Error("Fail message received.");
    } else {
      const params = {
        QueueUrl: successSqsUrl,
        MessageBody: "Success",
      };
      console.log(`SQS parameters: ${JSON.stringify(params)}`);
      const response = await sqs.sendMessage(params);
      console.log(`Response from sending message: ${JSON.stringify(response)}`);
    }
  }
}

module.exports.simpleLambdaWorker = async (event) => {
  const simpleLambdaWorker = new SimpleLambdaWorker(event);
  await simpleLambdaWorker.handle();
};
