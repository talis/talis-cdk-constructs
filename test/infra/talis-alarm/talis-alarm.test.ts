import * as cdk from "aws-cdk-lib";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { TalisAlarm, TalisAlarmProps } from "../../../lib/talis-alarm";

describe("TalisAlarm", () => {
  function synth(props: Partial<TalisAlarmProps>): Template {
    const stack = new cdk.Stack(new cdk.App(), "TestStack");
    new TalisAlarm(stack, "Alarm", {
      metric: new cloudwatch.Metric({ namespace: "Test", metricName: "Test" }),
      threshold: 1,
      evaluationPeriods: 1,
      ...props,
    });
    return Template.fromStack(stack);
  }

  test("tags the alarm with the on-call team, runbook and Lambda function, and propagates its tags to EventBridge", () => {
    synth({
      onCallTeam: "talis-platform",
      runbookUrl: "https://example.com/runbooks/test",
      lambdaFunctionName: "my-function",
    }).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Tags: [
        { Key: "lambda_function", Value: "my-function" },
        { Key: "oncall_team", Value: "talis-platform" },
        { Key: "runbook_url", Value: "https://example.com/runbooks/test" },
      ],
      ActionConfiguration: { AlarmTagsPropagation: { Enabled: true } },
    });
  });

  test("adds no tags when none of the tag props are set", () => {
    synth({
      onCallTeam: undefined,
      runbookUrl: undefined,
      lambdaFunctionName: undefined,
    }).hasResourceProperties("AWS::CloudWatch::Alarm", {
      Tags: Match.absent(),
      ActionConfiguration: { AlarmTagsPropagation: { Enabled: true } },
    });
  });

  test("rejects a runbook URL that is not a valid tag value", () => {
    expect(() =>
      synth({ runbookUrl: "https://example.com/runbook?page=1" }),
    ).toThrow(/runbook_url .* is not a valid tag value/);
  });
});
