import { aws_cloudwatch as cloudwatch } from "aws-cdk-lib";

export interface TalisAlarmProps extends cloudwatch.AlarmProps {
  // Datadog On-Call team handle to page, e.g. talis-platform. Set as the
  // alarm's oncall_team tag. Leave undefined for alarms that should not page,
  // e.g. in development.
  readonly onCallTeam?: string | undefined;

  // Runbook linked from the page. Set as the alarm's runbook_url tag, so it
  // can only contain letters, digits, spaces and _ . : / = + - @
  readonly runbookUrl?: string | undefined;

  // Lambda function whose error logs the page links to, in CloudWatch Logs
  // Insights. Set as the alarm's lambda_function tag.
  readonly lambdaFunctionName?: string | undefined;
}
