import * as cdk from "aws-cdk-lib";
import { Annotations, Template } from "aws-cdk-lib/assertions";
import { ResourcePrefixer } from "../../../lib";
import { EmptyResource } from "../../fixtures/infra/empty_resource";
import { ResourcePrefixerTestCases } from "../../fixtures/infra/resource_prefixer_test_cases";

describe("Resource Prefixer", () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let resourcePrefixer: ResourcePrefixer;
  let emptyResourcePrefixer: ResourcePrefixer;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "AspectTestStack", {});
    resourcePrefixer = new ResourcePrefixer("test-prefix-");
    emptyResourcePrefixer = new ResourcePrefixer("");
  });

  describe("Basic Usage - Empty Prefix", () => {
    test.each(ResourcePrefixerTestCases)(
      "Does not change the name of $expectedType",
      ({
        resourceType,
        resourceProps,
        expectedType,
        expectedPropsUnprefixed,
      }) => {
        new resourceType(stack, "test-item", resourceProps);
        cdk.Aspects.of(stack).add(emptyResourcePrefixer);
        Template.fromStack(stack).hasResourceProperties(
          expectedType,
          expectedPropsUnprefixed,
        );
      },
    );
  });

  describe("Basic Usage - With Prefix", () => {
    test.each(ResourcePrefixerTestCases)(
      "Prefixes the name of $expectedType",
      ({
        resourceType,
        resourceProps,
        expectedType,
        expectedPropsPrefixed,
      }) => {
        new resourceType(stack, "test-item", resourceProps);
        cdk.Aspects.of(stack).add(resourcePrefixer);
        Template.fromStack(stack).hasResourceProperties(
          expectedType,
          expectedPropsPrefixed,
        );
      },
    );
  });

  describe("Undefined Resources", () => {
    test("Adds warning annotation if no prefixer registered for cloud formation resource", () => {
      new EmptyResource(stack, "empty", { type: "Empty::Resource " });
      cdk.Aspects.of(stack).add(resourcePrefixer);
      Annotations.fromStack(stack).hasWarning(
        "/AspectTestStack/empty",
        "No defined resource prefixer for: Empty::Resource ",
      );
    });
  });
});
