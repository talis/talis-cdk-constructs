# TalisCdkStack Example: SimpleTalisCdkStack

This is an example of using the TalisCdkStack in a simple stack.

## Note: Non-optional properties to TalisCdkStackProps must be passed in.

## Construct Diagram

## This Example

To build and deploy this example:

- `export AWS_PREFIX=development-XX-` where XX are your initials
  - This is used in the name of the stack and resources created, so that they do not clash with anyone elses stack in AWS
- `source awsenv <profile>` to set your credentials to the shared account
- `npm ci` in the repository root (examples share its dependencies and run straight from TypeScript via `tsx`)
- `npx cdk deploy`

After you have finished with the example, remove your stack in AWS using:

- `npx cdk destroy`

## Useful commands

- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
