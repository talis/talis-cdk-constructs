# Talis CDK constructs

A Talis library of AWS CDK constructs, implemented in TypeScript. Development uses
Node.js 26 (see `.nvmrc`); published code and Lambda bundles target Node.js 22+.

## Contributing

This project follows [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/), and enforces this choice during the build and release cycle.

Builds are conducted by CircleCI, and upon successful build of the `main` branch, [`semantic-release`](https://semantic-release.gitbook.io/semantic-release/) will generate a new release, an appropriate version (based on commits), and release-notes to cover the content of the commit log.

## Available constructs

- CDN Site Hosting constructs
  - `CdnSiteHostingConstruct` for static-site or single-page application hosting in S3 via CloudFront.
  - `CdnSiteHostingWithDnsConstruct` for static-site or single-page application hosting in S3 via CloudFront, with DNS record provisioning

- `LambdaWorker`
  - A serverless background job.
  - Possible replacement for Resque Workers / Jobs
  - Details [here](/examples/simple-lambda-worker/README.md).

- `AuthenticatedApi`(http api)
  - An API Gateway (v2)
  - Built in optional Persona authentication on routes
    - Point it at Persona with `personaOrigin` (e.g. `"https://users.talis.com"`) or the `persona` host/scheme/port object
  - Details [here](/examples/simple-authenticated-api/README.md).

- `AuthenticatedRestApi`(rest api)
  - An API Gateway Rest API
  - Built in optional Persona authentication on routes
    - Per-method required scopes via `requiredScope`, as in `AuthenticatedApi`
  - Details [here](/examples/simple-authenticated-rest-api/README.md).

- `TalisAlarm`
  - A CloudWatch `Alarm` with optional `onCallTeam`, `runbookUrl` and `lambdaFunctionName` props, set as its `oncall_team`, `runbook_url` and `lambda_function` tags
  - Its tags are propagated to EventBridge, where the rules deployed by [cdk-aws-alarms](https://github.com/talis/cdk-aws-alarms) page that Datadog On-Call team. No SNS topic is needed
  - Tags only propagate when `onCallTeam` is set, so alarms that don't page are unchanged
  - Tag values can only contain letters, digits, spaces and `_ . : / = + - @`, so a `runbookUrl` with `?`, `&`, `#` or `%` (e.g. a Confluence `?pageId=` link or a percent-encoded title) fails at synth. Link to a page with a plain path, e.g. on GitHub or a Confluence short link
  - Used by `LambdaWorker`, `AuthenticatedApi` and `AuthenticatedRestApi`, which take `onCallTeam` and `runbookUrl` and set `lambdaFunctionName` on their Lambda alarms; their `alarmTopic` is now optional
  - `LambdaWorker` also takes `runbookUrls` (`dlqMessagesVisible`, `queueMessageAge`) to link a different runbook per alarm, falling back to `runbookUrl`
  - Those constructs warn at synth (`talis-cdk-constructs:alarmsWithoutActions`) when neither `alarmTopic` nor `onCallTeam` is set, as their alarms then do nothing

- `TalisCdkStack`
  - Base stack to be extended by talis stacks
  - Details [here](/lib/talis-cdk-stack/README.md)

## Available Constants

- `TalisRegion`
  - Aliases of AWS regions to the regions we deploy applications
  - Details [here](/lib/talis-cdk-stack/README.md)

- `TalisDeploymentEnvironment`
  - Aliases and resuable constants for referencing our specific deployment environments.
  - Details [here](/lib/talis-cdk-stack/README.md)

## Available Aspects

- `ResourcePrefixer`
  - Prefixs all AWS resources with the given prefix
  - Details [here](/lib/aspects/README.md)

## Useful commands

- `npm run build` compile `lib/` to `dist/` (only needed for publishing; tests and examples run the TypeScript source directly)
- `npm run typecheck` type-check everything (lib, lambdas, tests, examples)
- `npm test` run all tests with Vitest
- `npm run unit-test` / `npm run infra-test` / `npm run integration-test` run one test suite
- `npm run lint` check formatting (oxfmt), lint (oxlint) and types (tsc)
- `npm run format` format the code (oxfmt)

## Integration Tests

The integration tests are run against versions of the example projects deployed into AWS.

To run the integration tests locally:

- `export AWS_PREFIX=development-XX-` where XX are your initials
- The `authenticated-lambda` construct integration test needs the following environment variables for client/secrets. The values can be found by searching for `talis-cdk-construct integration tests` in keeper.
  - `export TALIS_CDK_AUTH_API_MISSING_SCOPE_CLIENT=`
  - `export TALIS_CDK_AUTH_API_MISSING_SCOPE_SECRET=`
  - `export TALIS_CDK_AUTH_API_VALID_CLIENT=`
  - `export TALIS_CDK_AUTH_API_VALID_SECRET=`
- Following the instruction to deploy the `simple-lambda-worker` in the examples readme.
- Following the instruction to deploy the `simple-authenticated-api` in the examples readme.
- `npm run integration-test`
