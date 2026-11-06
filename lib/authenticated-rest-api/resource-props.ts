import * as cdk from "aws-cdk-lib";
import { AuthenticatedRestApiFunction } from "./authenticated-rest-api-function";

export interface ResourceProps {
  name: string;
  methods?: {
    [key: string]: {
      function: AuthenticatedRestApiFunction;
      requestParameters?: {
        [param: string]: boolean;
      };
      isPublic?: boolean;
      requiredScope?: string;
      lambdaDurationAlarmThreshold: cdk.Duration;
    };
  };
  nestedResources?: ResourceProps[];
}
