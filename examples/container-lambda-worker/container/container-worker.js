module.exports.containerLambdaWorker = async (event) => {
  for (const record of event.Records) {
    console.log(`Container worker processing message: ${record.body}`);
    const { result } = JSON.parse(record.body);
    if (result === "FAIL") {
      throw Error("Fail message received.");
    }
  }
};
