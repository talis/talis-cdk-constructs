import axios from "axios";
import { CloudFront } from "aws-sdk";

async function assertWebsiteCreated(url: string, content: string) {
  const response = await axios.get(url);
  expect(response.status).toBe(200);
  expect(response.data).toContain(content);
}

async function assertWebsiteDoesNotExist(url: string, errorMessage: string) {
  try {
    await axios.get(url);
    fail("Expected to fail");
  } catch (err) {
    if (axios.isAxiosError(err)) {
      expect(err.message).toBe(errorMessage);
    } else {
      throw err;
    }
  }
}

async function findCloudfrontDistributionDomainName(
  name: string,
): Promise<string> {
  const client = new CloudFront();
  const response = await client.listDistributions().promise();

  if (!response.DistributionList?.Items) {
    throw Error("Distribution not found");
  }

  for (const distribution of response.DistributionList.Items) {
    if (distribution.Aliases.Items?.includes(name)) {
      return distribution.DomainName;
    }
  }

  throw Error("Distribution not found");
}

async function findCloudfrontDistributionAliases(
  name: string,
): Promise<CloudFront.AliasList> {
  const client = new CloudFront();
  const response = await client.listDistributions().promise();

  if (!response.DistributionList?.Items) {
    throw Error("Distribution not found");
  }

  for (const distribution of response.DistributionList.Items) {
    if (distribution.Aliases.Items?.includes(name)) {
      return distribution.Aliases.Items;
    }
  }

  throw Error("Distribution not found");
}

// These integration tests run against the simple cdn site hosting construct example, deployed in AWS
// The example contains two cdn hosted websites, one with DNS and one without

describe("CdnSiteHostingConstruct with no DNS", () => {
  test("successfully creates static website at cloudfront distribution domain name", async () => {
    const domainName = await findCloudfrontDistributionDomainName(
      `${process.env.AWS_PREFIX}cdn-site-hosting-construct.talis.io`,
    );
    await assertWebsiteCreated(`https://${domainName}`, "Test Deployment");
  });

  test("does not create static website accessable at default alias", async () => {
    const domainName = `${process.env.AWS_PREFIX}cdn-site-hosting-construct.talis.io`;
    await assertWebsiteDoesNotExist(
      `https://${domainName}`,
      `getaddrinfo ENOTFOUND ${process.env.AWS_PREFIX}cdn-site-hosting-construct.talis.io`,
    );
  });

  test("does not create static website accessable at additional alias", async () => {
    const domainName = `${process.env.AWS_PREFIX}cdn-site-hosting-construct-alias.talis.io`;
    await assertWebsiteDoesNotExist(
      `https://${domainName}`,
      `getaddrinfo ENOTFOUND ${process.env.AWS_PREFIX}cdn-site-hosting-construct-alias.talis.io`,
    );
  });

  test("creates multiple aliases on the cloudfront distribution", async () => {
    const aliases = await findCloudfrontDistributionAliases(
      `${process.env.AWS_PREFIX}cdn-site-hosting-construct.talis.io`,
    );
    expect(aliases.length).toBe(2);
    expect(aliases).toContain(`${process.env.AWS_PREFIX}cdn-site-hosting-construct.talis.io`);
    expect(aliases).toContain(`${process.env.AWS_PREFIX}cdn-site-hosting-construct-alias.talis.io`);
  });
});

describe("CdnSiteHostingWithDnsConstruct", () => {
  test("successfully creates static website at cloudfront distribution domain name", async () => {
    const domainName = await findCloudfrontDistributionDomainName(
      `${process.env.AWS_PREFIX}cdn-site-hosting-with-dns-construct.talis.io`,
    );
    await assertWebsiteCreated(`https://${domainName}`, "Test Deployment");
  });

  test("successfully creates static website accessable at alias", async () => {
    const domainName = `${process.env.AWS_PREFIX}cdn-site-hosting-with-dns-construct.talis.io`;
    await assertWebsiteCreated(`https://${domainName}`, "Test Deployment");
  });

  test("creates an aliase on the cloudfront distribution", async () => {
    const aliases = await findCloudfrontDistributionAliases(
      `${process.env.AWS_PREFIX}cdn-site-hosting-with-dns-construct.talis.io`,
    );
    expect(aliases.length).toBe(1);
    expect(aliases).toContain(`${process.env.AWS_PREFIX}cdn-site-hosting-with-dns-construct.talis.io`);
  });
});
