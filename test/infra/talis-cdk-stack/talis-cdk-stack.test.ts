import * as cdk from "aws-cdk-lib";
import { aws_sns as sns } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import {
  TalisDeploymentEnvironment,
  TalisCdkStack,
  TalisCdkStackProps,
  TalisShortRegion,
  TalisRegion,
} from "../../../lib";

describe("Talis CDK Stack", () => {
  let stack: TalisCdkStack;
  let app: cdk.App;
  let props: TalisCdkStackProps;

  describe("Default environment removal policies", () => {
    beforeEach(() => {
      app = new cdk.App();
      props = {
        deploymentEnvironment: TalisDeploymentEnvironment.TEST,
        app: "test-depot",
        release: "test1-105814f",
      };
      stack = new TalisCdkStack(app, "test-stack", props);
    });

    test.each([
      [TalisDeploymentEnvironment.BUILD, cdk.RemovalPolicy.DESTROY],
      [TalisDeploymentEnvironment.DEVELOPMENT, cdk.RemovalPolicy.DESTROY],
      [TalisDeploymentEnvironment.TEST, cdk.RemovalPolicy.DESTROY],
      [TalisDeploymentEnvironment.STAGING, cdk.RemovalPolicy.SNAPSHOT],
      [TalisDeploymentEnvironment.PRODUCTION, cdk.RemovalPolicy.RETAIN],
      [TalisDeploymentEnvironment.PREVIEW, cdk.RemovalPolicy.RETAIN],
      [TalisDeploymentEnvironment.ONDEMAND, cdk.RemovalPolicy.RETAIN],
    ])(
      "Environment %s should have removal policy of %s",
      (environment, expected) => {
        expect(
          stack.getRemovalPolicyForTalisDeploymentEnvironment(environment),
        ).toBe(expected);
      },
    );
  });
  describe("Tags are applied to resources", () => {
    it("Should have the correct tags", () => {
      app = new cdk.App();
      stack = new TalisCdkStack(app, "TestStack", {
        deploymentEnvironment: TalisDeploymentEnvironment.TEST,
        app: "depot",
        release: "1234-105814f",
        env: {
          region: TalisRegion.EU,
        },
      });

      new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      Template.fromStack(stack).resourceCountIs("AWS::SNS::Topic", 1);

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::Topic", {
        Tags: [
          {
            Key: "talis:product",
            Value: "depot",
          },
          {
            Key: "tfs-app",
            Value: "depot",
          },
          {
            Key: "tfs-environment",
            Value: "test",
          },
          {
            Key: "tfs-region",
            Value: "eu",
          },
          {
            Key: "tfs-release",
            Value: "1234-105814f",
          },
          {
            Key: "tfs-service",
            Value: "depot-test-eu",
          },
        ],
        TopicName: "TestAlarm",
      });
    });
    it("Should have correct tags when no environment", () => {
      app = new cdk.App();
      stack = new TalisCdkStack(app, "TestStack", {
        deploymentEnvironment: TalisDeploymentEnvironment.TEST,
        app: "test-depot",
        release: "test1-105814f",
      });

      new sns.Topic(stack, "TestAlarm", {
        topicName: "TestAlarm",
      });

      Template.fromStack(stack).resourceCountIs("AWS::SNS::Topic", 1);

      Template.fromStack(stack).hasResourceProperties("AWS::SNS::Topic", {
        Tags: [
          {
            Key: "talis:product",
            Value: "test-depot",
          },
          {
            Key: "tfs-app",
            Value: "test-depot",
          },
          {
            Key: "tfs-environment",
            Value: "test",
          },
          {
            Key: "tfs-release",
            Value: "test1-105814f",
          },
        ],
        TopicName: "TestAlarm",
      });
    });
    describe("should set the correct tfs-region for all env.regions", () => {
      test.each([
        [TalisRegion.CANADA, TalisShortRegion.CANADA],
        [TalisRegion.EU, TalisShortRegion.EU],
        [TalisRegion.LOCAL, TalisShortRegion.LOCAL],
      ])(
        "Environment AWS region %s should have tfs-region of %s",
        (envAwsRegion, expectedShortRegion) => {
          app = new cdk.App();
          props = {
            deploymentEnvironment: TalisDeploymentEnvironment.TEST,
            app: "test-depot",
            release: "test1-105814f",
            env: {
              region: envAwsRegion,
            },
          };
          stack = new TalisCdkStack(app, "test-stack", props);
          new sns.Topic(stack, "TestAlarm", {
            topicName: "TestAlarm",
          });

          Template.fromStack(stack).resourceCountIs("AWS::SNS::Topic", 1);
          console.log(expectedShortRegion); // Fix eslint until below is fixed
          Template.fromStack(stack).hasResourceProperties("AWS::SNS::Topic", {
            Tags: Match.arrayWith([
              { Key: "tfs-region", Value: expectedShortRegion },
            ]),
          });
        },
      );
    });
    describe("should set the correct tfs-service for all apps, dev environments and regions", () => {
      const testcases = [
        {
          devEnvironment: TalisDeploymentEnvironment.TEST,
          region: TalisRegion.EU,
          expectedTfsService: "depot-test-eu",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.DEVELOPMENT,
          region: TalisRegion.LOCAL,
          expectedTfsService: "depot-development-local",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.BUILD,
          region: TalisRegion.CANADA,
          expectedTfsService: "depot-build-ca",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.ONDEMAND,
          region: TalisRegion.EU,
          expectedTfsService: "depot-ondemand-eu",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.STAGING,
          region: TalisRegion.EU,
          expectedTfsService: "depot-staging-eu",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.PRODUCTION,
          region: TalisRegion.EU,
          expectedTfsService: "depot-eu",
        },
        {
          devEnvironment: TalisDeploymentEnvironment.PREVIEW,
          region: TalisRegion.EU,
          expectedTfsService: "depot-preview-eu",
        },
      ];
      testcases.forEach((testcase) => {
        test(`given app='depot', AWS props.env.region='${testcase.region}' and devEnvironment='${testcase.devEnvironment}' then tfs-service='${testcase.expectedTfsService}'`, () => {
          app = new cdk.App();
          props = {
            deploymentEnvironment: testcase.devEnvironment,
            app: "depot",
            release: "test1-105814f",
            env: {
              region: testcase.region,
            },
          };
          stack = new TalisCdkStack(app, "test-stack", props);
          new sns.Topic(stack, "TestAlarm", {
            topicName: "TestAlarm",
          });

          Template.fromStack(stack).resourceCountIs("AWS::SNS::Topic", 1);
          Template.fromStack(stack).hasResourceProperties("AWS::SNS::Topic", {
            Tags: Match.arrayWith([
              { Key: "tfs-service", Value: testcase.expectedTfsService },
            ]),
          });
        });
      });
    });
  });
});
