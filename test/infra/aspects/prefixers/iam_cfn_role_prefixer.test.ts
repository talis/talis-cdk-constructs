import * as iam from "@aws-cdk/aws-iam";
import * as cdk from "@aws-cdk/core";

import { expect as expectCDK, haveResource } from "@aws-cdk/assert";
import { IamCfnRolePrefixer } from "../../../../lib";
import { CfnRoleProperties } from "../../../fixtures/infra/aws-iam/cfn_role";
import { EmptyResource } from "../../../fixtures/infra/empty_resource";
import { Match, Template } from "@aws-cdk/assertions";

describe("IAM CfnRole Prefixer", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let cfnRole: iam.CfnRole;
  let prefixer: IamCfnRolePrefixer;
  let emptyPrefixer: IamCfnRolePrefixer;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "AspectTestStack", {});
    cfnRole = new iam.CfnRole(stack, "role2", CfnRoleProperties);
    prefixer = new IamCfnRolePrefixer(cfnRole, "test-prefix-");
    emptyPrefixer = new IamCfnRolePrefixer(cfnRole, "");
  });

  describe("Empty Prefix", () => {
    test("Keeps role name the same", () => {
      emptyPrefixer.prefix();

      expectCDK(stack).to(
        haveResource("AWS::IAM::Role", {
          RoleName: "roleName",
        })
      );
    });
  });

  describe("With Prefix", () => {
    test("Adds prefix to the start of the role name", () => {
      prefixer.prefix();

      expectCDK(stack).to(
        haveResource("AWS::IAM::Role", {
          RoleName: "test-prefix-roleName",
        })
      );
    });

    test("Adds prefix to the start of logical id if no role name given", () => {
      const app = new cdk.App();
      const stack = new cdk.Stack(app, "AspectTestStack", {});
      const cfnRole = new iam.CfnRole(stack, "roleOther", {
        assumeRolePolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: {
                Service: ["ec2.amazonaws.com"],
              },
              Action: ["sts:AssumeRole"],
            },
          ],
        },
      });
      const prefixer = new IamCfnRolePrefixer(cfnRole, "test-prefix-");

      prefixer.prefix();

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Role", {
        RoleName: Match.stringLikeRegexp("test-prefix-"),
      });
    });
  });

  describe("Undefined Resource", () => {
    test("Raises error if no prefixer defined for resource", () => {
      const unknownResource = new EmptyResource(stack, "empty", {
        type: "EmptyResource",
      });

      expect(() => {
        new IamCfnRolePrefixer(unknownResource, "prefix");
      }).toThrowError(
        "Specified node is not an instance of CfnRole and cannot be prefixed using this prefixer"
      );
    });
  });
});
