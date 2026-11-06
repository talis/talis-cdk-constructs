# CdnSiteHostingConstruct Example: SimpleCdnSiteHostingConstructStack

This is an example of using the CdnSiteHostingConstruct and the CdnSiteHostingWithDnsConstruct in a simple stack to host a static website.

The CdnSiteHostingConstruct:

- creates a bucket to host the static html
- creates a cloudfront distribution to server the website

Optionionally, the CdnSiteHostingWithDnsConstruct:

- sets up a DNS entry int Route 53 pointing at the cloudfront distribution

## This Example

To build and deploy this example:

- `export AWS_PREFIX=development-XX-` where XX are your initials
  - This is used in the name of the stack and resources created, so that they do not clash with anyone elses stack in AWS
- `source awsenv <profile>` to set your credentials to the shared account
- `npm ci` in the repository root (examples share its dependencies and run straight from TypeScript via `tsx`)
- `npx cdk deploy`

After you have finished with the example, remove your stack in AWS using:

- `npx cdk destroy`

## Best Practice Using this Construct

It's best practice NOT to create a DNS entry for a production website within a cloud formation stack. In production
best practice is to be bring up a cloud formation stack and manually point a route 53 entry to the cloud front distribution.

Why? We want the ability, if necessary, to bring up a new cloud formation stack and when we are happy that it is working
as expected, switch the DNS manually to point to the new stack.

Therefore, production deployments should use the CdnSiteHostingConstruct and set a watermarked sub domain name. For example:

```typescript
    new CdnSiteHostingConstruct(
      this,
      `TalisAppCdnSiteHostingConstruct`,
      {
        domainName: "talis.io",
        siteSubDomain: `production-eu-20231025-talis-app`,
        aliasSubDomains: ['talis-app'],
        ...
      },
    );
```

The above will create a cloud front distribution with two aliases:

- `production-eu-20231025-talis-app.talis.io`
- `talis-app.talis.io`

Outside of the cloud formation stack, DNS entries can be manually created for both the aliases and either can be used to access the website.

Unfortunately, cloud front can NOT have the same alias on two different distributions. This means we can not always set the `talis-app` alias from
the above example on a new cloud front distribution. i.e. Attempting to create:

```typescript
    new CdnSiteHostingConstruct(
      this,
      `TalisAppCdnSiteHostingConstruct`,
      {
        domainName: "talis.io",
        siteSubDomain: `production-eu-20231026-talis-app`,
        aliasSubDomains: ['talis-app'],
        ...
      },
    );
```

will fail. Despite the cloud formation stack having a different watermark, 20231026 instead of 20231025, and the siteSubDomain being `production-eu-20231026-talis-app.talis.io` instead of `production-eu-20231025-talis-app.talis.io` - the creation of the stack will fail due to the duplicate alias `talis-app.talis.io`.

Therefore - when bringing up a new watermarked stack alongside an already live production stack, the alias sub domain must not initially be set:

```typescript
    new CdnSiteHostingConstruct(
      this,
      `TalisAppCdnSiteHostingConstruct`,
      {
        domainName: "talis.io",
        siteSubDomain: `production-eu-20231026-talis-app`,
        aliasSubDomains: [],
        ...
      },
    );
```

This will mean the new stack can be deployed and tested at the watermarked DNS name, e.g. `production-eu-20231026-talis-app.talis.io`.

When ready to switch the stacks in production, the `talis-app.talis.io` alias needs to be deleted from the old stack and added to the new stack manually.
The DNS is then switched from the old cloud front distribution to the new one.

If this was a simple DNS change, there would be no downtime. But due to the need to delete and recreate the alias on the cloud front distribution, there is a small
period where the website is in accessible. Therefore, for a production site, ONLY when switching to a new cloud formation stack, NOT on every release, a maintenance
window is required for the switch over.

Subsequent deployments after the stack switch over DO need to add in the `talis-app` alias to the aliasSubDomains property of the construct. If they do not,
the alias will be deleted and an outage will occur.

This process should be managed via the hercules deployment script - setting up the `aliasSubDomain` for a standard deploy to the live watermark to include the
additional alias. When a different watermark is specified, to bring up a new none live stack, hercules should ensure the `aliasSubDomain` property does not
contain the additional alias.

This will require logic in both the hercules script and the projects CDK deployment code to ensure this property is set correctly.

### Smalti Example

This is an example of the best practice described above using smalti app (i.e. the Admin UI project) as an example.

#### Hercules

The default command to deploy the smalti admin ui is

```
@hercules smalti-app deploy <environment> <region> <version>
```

e.g.

```
@hercules smalti-app deploy production eu 63-14c218fb2c88afc0905be5c4e65af7a50cfe1071
```

This deploys a new version of the smalti-app to the existing stack. This is the standard deployment which happens most of the time.

In the hercules script [here](https://github.com/talis/hercules/blob/master/scripts/smalti-app.js#L23) the watermarks of the current live stacks are
defined in the config:

```javascript
const ENVIRONMENT_CONFIGS = {
  staging: {
    eu: {
      circleciDeployContext: CIRCLECI_CONTEXT_CDK_DEPLOY_TO_SHARED_ASPIRE,
      circleciRegionContext: CIRCLECI_CONTEXT_AWS_REGION_EU,
      appEnvironment: "staging-eu",
      releaseWatermark: "231114",
    },
  },
  production: {
    eu: {
      circleciDeployContext: CIRCLECI_CONTEXT_CDK_DEPLOY_TO_DEVOPS_ASPIRE,
      circleciRegionContext: CIRCLECI_CONTEXT_AWS_REGION_EU,
      appEnvironment: "production-eu",
      releaseWatermark: "231115",
    },
    ca: {
      circleciDeployContext: CIRCLECI_CONTEXT_CDK_DEPLOY_TO_DEVOPS_ASPIRE,
      circleciRegionContext: CIRCLECI_CONTEXT_AWS_REGION_CA,
      appEnvironment: "production-ca",
      releaseWatermark: "231115",
    },
  },
};
```

Hercules passes this default `releaseWatermark` to circle which will deploy the new version to the stack with that watermark. The existing
stack is named `production-eu-231115-smalti-app`,

This is done [here](https://github.com/talis/hercules/blob/master/scripts/smalti-app.js#L112):

```
    const parameters = {
      is_deploy: true,
      release_version: version,
      app_environment: ENVIRONMENT_CONFIGS[environment][region].appEnvironment,
      release_app_watermark: releaseWatermark.trim(),
      web_host: `http://${ENVIRONMENT_CONFIGS[environment][region].appEnvironment}-${releaseWatermark.trim()}-lti-admin.talis.io/`,
      api_host: `https://${ENVIRONMENT_CONFIGS[environment][region].appEnvironment}-lti.talis.io/`,
      is_live: releaseWatermark.trim() === ENVIRONMENT_CONFIGS[environment][region].releaseWatermark,
      slack_user: res.message.user.id,
      aws_deploy_context:
        ENVIRONMENT_CONFIGS[environment][region].circleciDeployContext,
      aws_region_context:
        ENVIRONMENT_CONFIGS[environment][region].circleciRegionContext,
    };

    circleciV2Api
      .triggerANewPipeline(repository, 'main', parameters)
```

But in the `parameters`, in addition to the `release_app_watermark` is a flag `is_live`.

`is_live` is set to true because the `release_app_watermark` we are using is the watermark of the currently live stack:

```
is_live: releaseWatermark.trim() === ENVIRONMENT_CONFIGS[environment][region].releaseWatermark,
```

However, when creating a new stack alongside a currently live stack, the hercules command used for the deployment is:

```
@hercules smalti-app deploy <environment> <region> <version> [<watermark>]
```

e.g.

```
@hercules smalti-app deploy production eu 63-14c218fb2c88afc0905be5c4e65af7a50cfe1071 231124
```

This results in a new stack being created alongside the existing live one. The two stacks in production would be:

- `production-eu-231115-smalti-app`
- `production-eu-231124-smalti-app`

The `is_live` flag passed to circle by hercules, is set to false - because the watermark is not the watermark from the config:

```
is_live: releaseWatermark.trim() === ENVIRONMENT_CONFIGS[environment][region].releaseWatermark,
```

#### Circle

The circle build is passed an `is_live` flag from hercules.

All the circle build does with this flag is pass it to the CDK code via an environment variable [here](https://github.com/talis/smalti-app/blob/main/.circleci/config.yml#L67).

```
    steps:
      - run:
          name: Export AWS/CDK environment variables
          command: |
            echo "export AWS_ACCESS_KEY_ID=${<< parameters.aws_access_key_id >>}" >> $BASH_ENV
            echo "export AWS_DEFAULT_REGION=${<< parameters.aws_default_region >>}" >> $BASH_ENV
            echo "export AWS_SECRET_ACCESS_KEY=${<< parameters.aws_secret_access_key >>}" >> $BASH_ENV
            echo "export WATERMARK=<< parameters.release_app_watermark >>" >> $BASH_ENV
            echo "export AWS_PREFIX=<< parameters.app_environment >>-<< parameters.release_app_watermark >>-" >> $BASH_ENV
            echo "export RELEASE_IDENTIFIER=<< parameters.release_version >>" >> $BASH_ENV
            echo "export WEB_HOST=<< parameters.web_host >>" >> $BASH_ENV
            echo "export API_HOST=<< parameters.api_host >>" >> $BASH_ENV
            echo "export APP_ENVIRONMENT=<< parameters.app_environment >>" >> $BASH_ENV
            echo "export IS_LIVE=<< parameters.is_live >>" >> $BASH_ENV
            source $BASH_ENV
```

#### CDK

The CDK code reads the `is_live` value [here](https://github.com/talis/smalti-app/blob/main/infra/bin/smalti-app.ts#L44):

```
const isLive = process.env.IS_LIVE === 'true' ? true : false;
```

and then uses it to either set or not set the `aliasSubdomain` for the stack, depending on whether it is live or not:

```
const productionEuConfig: SmaltiAppStackProps = {
  prefix,
  release,
  app: APP_NAME,
  deploymentEnvironment: TalisDeploymentEnvironment.PRODUCTION,
  env: {
    account: PRODUCTION_ACCOUNT_ID,
    region: TalisRegion.EU,
  },
  tags: { env: TalisDeploymentEnvironment.PRODUCTION },
  domainName: `talis.com`,
  subDomain: `${prefix}lti-admin`,
  aliasSubDomains: isLive ? ['lti-admin.talis.com'] : [],
  assetPath: path.join(__dirname, '../../dist'),
  certificateArn: PRODUCTION_EU_CLOUDFRONT_TALIS_TLS_CERT_ARN,
};
```

Specifically here:

```
  aliasSubDomains: isLive ? ['lti-admin.talis.com'] : [],
```

This means that:

- live stacks will have the `aliasSubdomains` set. Repeated deployments will not delete it.
- new deployments, with a new watermark will not have any `aliasSubDomains` set. This is what we want. They can not exist in two places at once and have to be moved at the time of making the new stack live.

#### Post Making The New Stack Live

After making the new stack live, it is already our process to update the live watermark in the hercules script to the new value.

If this were not done, future standard releases would bring up the old stack again.

Having done this, future deployments to the new stack, `231124` in our example, will have the `is_live` flag set and will continue as normal.

## Useful commands

- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template
