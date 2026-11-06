import * as cdk from "aws-cdk-lib";
import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";
import { Construct } from "constructs";

import { TalisAlarmProps } from "./talis-alarm-props";

// What CloudWatch accepts in a tag value.
const TAG_VALUE = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]{0,256}$/u;

// A CloudWatch alarm that pages a Datadog On-Call team when tagged with one.
// Its tags, including oncall_team and runbook_url, are copied into its
// EventBridge "CloudWatch Alarm State Change" events, where the paging rules
// deployed by cdk-aws-alarms match them. No SNS topic is needed.
export class TalisAlarm extends cloudwatch.Alarm {
  constructor(scope: Construct, id: string, props: TalisAlarmProps) {
    const { onCallTeam, runbookUrl, ...alarmProps } = props;
    super(scope, id, alarmProps);

    const tags = { oncall_team: onCallTeam, runbook_url: runbookUrl };
    for (const [key, value] of Object.entries(tags)) {
      if (value === undefined) continue;
      if (!cdk.Token.isUnresolved(value) && !TAG_VALUE.test(value)) {
        throw new Error(
          `${key} '${value}' is not a valid tag value: up to 256 letters, digits, spaces and _ . : / = + - @`,
        );
      }
      cdk.Tags.of(this).add(key, value);
    }

    // Set as an override because CfnAlarm only has actionConfiguration from aws-cdk-lib 2.275.0.
    (this.node.defaultChild as cloudwatch.CfnAlarm).addPropertyOverride(
      "ActionConfiguration.AlarmTagsPropagation.Enabled",
      true,
    );
    // The schema used by synth-time validation (@aws-cdk/core:validateAgainstDefaultRules, on in
    // new apps) predates ActionConfiguration. Validations only exists in recent aws-cdk-lib.
    (cdk as { Validations?: CdkValidations }).Validations?.of(this).acknowledge(
      {
        id: "CloudFormation-Validate::F3002",
        reason: "ActionConfiguration is valid but missing from the schema",
      },
    );
  }
}

// shortcut: the part of cdk.Validations used above, until the peer dependency is >= 2.275.0.
interface CdkValidations {
  of(scope: Construct): {
    acknowledge(...rules: { id: string; reason: string }[]): void;
  };
}
