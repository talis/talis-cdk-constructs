import { CfnResource, IAspect, IConstruct } from "@aws-cdk/core";
import { DynamoDbCfnTablePrefixer } from "./prefixers/dynamodb_cfn_table_prefixer";
import { CfnResourcePrefixer } from "./cfn_resource_prefixer";
import { CfnTable } from "@aws-cdk/aws-dynamodb";

export type Constructor<T> = { new (...args: any[]): T };

export class ResourcePrefixer implements IAspect {
  private prefix: string;
  private prefixers: Map<
    Constructor<CfnResource>,
    Constructor<CfnResourcePrefixer>[]
  >;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.prefixers = new Map<
      Constructor<CfnResource>,
      Constructor<CfnResourcePrefixer>[]
    >();

    this.registerPrefixer(CfnTable, DynamoDbCfnTablePrefixer);
  }

  public visit(node: IConstruct): void {
    // We only care about Cloudformation Resources so skip anything that isnot one
    if (!(node instanceof CfnResource)) {
      return;
    }

    for (const key of this.prefixers.keys()) {
      if (node instanceof key) {
        this.prefixers.get(key)?.forEach((prefixer) => {
          new prefixer(node, this.prefix).prefix();
        });
        // Return after running prefixers for resource as only one resource should match
        return;
      }
    }

    throw new Error("Undefined resource for resource prefixer");
  }

  private registerPrefixer(
    resource: Constructor<CfnResource>,
    prefixer: Constructor<CfnResourcePrefixer>
  ): void {
    if (this.prefixers.has(resource)) {
      const resourcePrefixers = this.prefixers.get(resource) ?? [];
      resourcePrefixers.push(prefixer);
      this.prefixers.set(resource, resourcePrefixers);
    } else {
      this.prefixers.set(resource, [prefixer]);
    }
  }
}