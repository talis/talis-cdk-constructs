import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";

export interface RouteUrlProps {
  name: string;
  baseUrl: string;
  path: string;
  method: apigatewayv2.HttpMethod;
  isPublic?: boolean; // Defaults to false: requests need a Persona token
  requiredScope?: string;
}
