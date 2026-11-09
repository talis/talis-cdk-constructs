import * as cdk from "aws-cdk-lib";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { Construct } from "constructs";

import { TalisAlarmProps } from "./talis-alarm-props";

// What CloudWatch accepts in a tag value.
const TAG_VALUE = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]{0,256}$/u;

// A CloudWatch alarm that pages a Datadog On-Call team when tagged with one.
// Its tags, including oncall_team, runbook_url and lambda_function, are copied into its
// EventBridge "CloudWatch Alarm State Change" events, where the paging rules
// deployed by cdk-aws-alarms match them. No SNS topic is needed.
export class TalisAlarm extends cloudwatch.Alarm {
  constructor(scope: Construct, id: string, props: TalisAlarmProps) {
    const { onCallTeam, runbookUrl, lambdaFunctionName, ...alarmProps } = props;
    super(scope, id, alarmProps);

    const tags = {
      oncall_team: onCallTeam,
      runbook_url: runbookUrl,
      lambda_function: lambdaFunctionName,
    };
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined) continue;
      if (!cdk.Token.isUnresolved(value) && !TAG_VALUE.test(value)) {
        throw new Error(
          `${key} '${value}' is not a valid tag value: up to 256 letters, digits, spaces and _ . : / = + - @`,
        );
      }
      cdk.Tags.of(this).add(key, value);
    }

    // Without a team there's nothing to page, so leave the alarm as it was.
    if (onCallTeam === undefined) {
      return;
    }

    (this.node.defaultChild as cloudwatch.CfnAlarm).actionConfiguration = {
      alarmTagsPropagation: { enabled: true },
    };
    // The schema used by synth-time validation (@aws-cdk/core:validateAgainstDefaultRules, on in
    // new apps) predates ActionConfiguration.
    cdk.Validations.of(this).acknowledge({
      id: "CloudFormation-Validate::F3002",
      reason: "ActionConfiguration is valid but missing from the schema",
    });
  }
}
