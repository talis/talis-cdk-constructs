import * as cdk from "aws-cdk-lib";
import { aws_logs as awslogs } from "aws-cdk-lib";
import { aws_ec2 as ec2 } from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";

import { PersonaProps } from "../util/persona-origin";

import { ResourceProps } from "./resource-props";

export interface AuthenticatedRestApiProps {
  prefix: string;
  name: string;
  description: string;
  stageName: string;
  resourceProps: ResourceProps[];
  securityGroups?: Array<ec2.ISecurityGroup>;
  vpc?: ec2.IVpc;
  vpcSubnets?: ec2.SubnetSelection;
  domainName: string;
  certificateArn: string;
  corsDomain?: string[];

  // Access logs via CloudWatch log group
  logging?: {
    /** @default false */
    enabled: boolean;
    /** @default JSON */
    format?: string;
    /** @default awslogs.RetentionDays.TWO_YEARS */
    retention?: awslogs.RetentionDays;
  };

  /**
   * Persona the authorizer validates tokens with, as host, scheme and port.
   * Set this or `personaOrigin`, not both.
   */
  persona?: PersonaProps;

  /**
   * Persona origin the authorizer validates tokens with,
   * e.g. "https://users.talis.com". Set this or `persona`, not both.
   */
  personaOrigin?: string;

  // Optional SNS Topic all alarm actions should be sent to
  alarmTopic?: sns.ITopic;

  // Datadog On-Call team paged by the alarms, and the runbook linked from
  // the page. See TalisAlarm.
  onCallTeam?: string | undefined;
  runbookUrl?: string | undefined;

  // The ApiGateway will have an alarm for the latency of responces.
  // This covers all routes in the API. By default the threshold for
  // this alarm will be one second. This default can be overriden by
  // setting the apiLatencyAlarmThreshold property.
  apiLatencyAlarmThreshold?: cdk.Duration;
}
