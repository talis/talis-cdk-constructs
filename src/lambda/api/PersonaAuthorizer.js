"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaAuthorizer = void 0;
const _ = require("lodash");
const talis_node_1 = require("talis-node");
// Constants used by parseMethodArn:
//
// Example MethodARN:
//   "arn:aws:execute-api:<Region id>:<Account id>:<API id>/<Stage>/<Method>/<Resource path>"
// Method ARN Index:  0   1   2           3           4            5
// API Gateway ARN Index:                                          0        1       2        3
//
//
const ARN_INDEX = 0;
const AWS_INDEX = 1;
const EXECUTE_INDEX = 2;
const REGION_INDEX = 3;
const ACCOUNT_ID_INDEX = 4;
const API_GATEWAY_ARN_INDEX = 5;
const METHOD_ARN_INDEXES = [
    ARN_INDEX,
    AWS_INDEX,
    EXECUTE_INDEX,
    REGION_INDEX,
    ACCOUNT_ID_INDEX,
    API_GATEWAY_ARN_INDEX,
];
const API_ID_INDEX = 0;
const STAGE_INDEX = 1;
const METHOD_INDEX = 2;
const RESOURCE_PATH_INDEX = 3;
const API_GATEWAY_ARN_INDEXES = [
    API_ID_INDEX,
    STAGE_INDEX,
    METHOD_INDEX,
    RESOURCE_PATH_INDEX,
];
class PersonaAuthorizer {
    constructor(event, context) {
        this.event = event;
        this.context = context;
        this.personaClient = undefined;
    }
    async handle() {
        var _a;
        console.log("Received event", this.event);
        if (!((_a = this.event) === null || _a === void 0 ? void 0 : _a.headers) || this.event.headers["authorization"] == null) {
            console.log("Missing auth token");
            return this.context.fail("Unauthorized");
        }
        const parsedMethodArn = this.parseMethodArn(this.event.routeArn);
        console.log(`Parsed Method Arn: ${JSON.stringify(parsedMethodArn)}`);
        const scope = this.getScope(parsedMethodArn);
        console.log(`Method has scope: ${scope}`);
        let validationOpts = {
            token: _.replace(this.event.headers["authorization"], "Bearer", "").trim(),
        };
        if (scope != null) {
            validationOpts = _.merge(validationOpts, { scope });
        }
        console.log(`Validation ops: ${JSON.stringify(validationOpts)}`);
        console.log("validating token against request", `${parsedMethodArn.resourcePath}`);
        if (!validationOpts.token || validationOpts.token.length === 0) {
            console.log("token missing");
            return this.context.fail("Unauthorized");
        }
        try {
            const token = await this.validateToken(validationOpts);
            const success = {
                isAuthorized: true,
                context: {
                    clientId: token["sub"],
                },
            };
            return this.context.succeed(success);
        }
        catch (err) {
            console.log("token validation failed", err);
            const error = err;
            if (error.error === talis_node_1.persona.errorTypes.INSUFFICIENT_SCOPE) {
                const insufficientScope = {
                    isAuthorized: false,
                    context: {
                        description: "Insufficient Scope",
                        clientId: (error === null || error === void 0 ? void 0 : error.token) ? error.token["sub"] : "",
                    },
                };
                return this.context.succeed(insufficientScope);
            }
            const failure = {
                isAuthorized: false,
                context: {
                    clientId: (error === null || error === void 0 ? void 0 : error.token) ? error.token["sub"] : "",
                },
            };
            return this.context.succeed(failure);
        }
    }
    validateToken(validationOpts) {
        const client = this.getPersonaClient();
        return new Promise(function (resolve, reject) {
            client.validateToken(validationOpts, (error, ok, decodedToken) => {
                if (error) {
                    reject({
                        error: error,
                        token: decodedToken,
                    });
                }
                resolve(decodedToken);
            });
        });
    }
    /**
     * Break down an API gateway method ARN into it's constituent parts.
     * Method ARNs take the following format:
     *
     *   arn:aws:execute-api:<Region id>:<Account id>:<API id>/<Stage>/<Method>/<Resource path>
     *
     * e.g:
     *
     *   arn:aws:execute-api:eu-west-1:123:abc/development/GET/2/works
     *
     * @param methodArn {string} The method ARN provided by the event handed to a Lambda function
     * @returns {{
     *   method: string,
     *   resourcePath: string,
     *   apiOptions: {
     *     region: string,
     *     restApiId: string,
     *     stage: string
     *   },
     *   awsAccountId: string
     *   }}
     */
    parseMethodArn(methodArn) {
        const methodArnParts = methodArn.split(":");
        console.log(`Method ARN Parts: ${JSON.stringify(methodArnParts)}`);
        let apiGatewayArn = methodArnParts[API_GATEWAY_ARN_INDEX];
        // If the split created more than the expected number of parts, then the
        // apiGatewayArn must have had one or more :'s in it. Recreate the apiGateway arn.
        for (let index = METHOD_ARN_INDEXES.length; index < methodArnParts.length; index += 1) {
            apiGatewayArn += `:${methodArnParts[index]}`;
        }
        const apiGatewayArnParts = apiGatewayArn.split("/");
        console.log(`api gateway arn parts: ${JSON.stringify(apiGatewayArnParts)}`);
        // If the split created more than the expected number of parts, then the
        // resource path must have had one or more /'s in it. Recreate the resource path.
        let resourcePath = "";
        for (let i = API_GATEWAY_ARN_INDEXES.length - 1; i < apiGatewayArnParts.length; i += 1) {
            resourcePath += `/${apiGatewayArnParts[i]}`;
        }
        console.log(`resource path: ${JSON.stringify(resourcePath)}`);
        return {
            method: apiGatewayArnParts[METHOD_INDEX],
            resourcePath,
            apiOptions: {
                region: methodArnParts[REGION_INDEX],
                restApiId: apiGatewayArnParts[API_ID_INDEX],
                stage: apiGatewayArnParts[STAGE_INDEX],
            },
            awsAccountId: methodArnParts[ACCOUNT_ID_INDEX],
        };
    }
    getScope(parsedMethodArn) {
        const scopeConfig = process.env["SCOPE_CONFIG"];
        if (scopeConfig != undefined) {
            const conf = JSON.parse(scopeConfig);
            for (const path of Object.keys(conf)) {
                if (this.pathMatch(path, parsedMethodArn.resourcePath)) {
                    return conf[path];
                }
            }
        }
        return null;
    }
    getPersonaClient() {
        if (this.personaClient == null) {
            const personaConfig = {
                persona_host: process.env["PERSONA_HOST"],
                persona_scheme: process.env["PERSONA_SCHEME"],
                persona_port: process.env["PERSONA_PORT"],
                persona_oauth_route: process.env["PERSONA_OAUTH_ROUTE"],
            };
            this.personaClient = talis_node_1.persona.createClient(`${process.env["PERSONA_CLIENT_NAME"]} (lambda; NODE_ENV=${process.env["NODE_ENV"]})`, _.merge(personaConfig, {}));
        }
        return this.personaClient;
    }
    pathMatch(pathDefinition, path) {
        const pathDefinitionParts = pathDefinition.split("/");
        const pathParts = path.split("/");
        if (pathDefinitionParts.length !== pathParts.length) {
            return false;
        }
        for (let i = 0; i < pathDefinitionParts.length; i++) {
            const pathDefinitionSegment = pathDefinitionParts[i];
            const pathSegment = pathParts[i];
            if (pathDefinitionSegment.startsWith("{") &&
                pathDefinitionSegment.endsWith("}")) {
                // Matches path argument
            }
            else {
                // Should match directly
                if (pathDefinitionSegment !== pathSegment) {
                    return false;
                }
            }
        }
        return true;
    }
}
exports.PersonaAuthorizer = PersonaAuthorizer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGVyc29uYUF1dGhvcml6ZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJQZXJzb25hQXV0aG9yaXplci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw0QkFBNEI7QUFDNUIsMkNBQW9EO0FBYXBELG9DQUFvQztBQUNwQyxFQUFFO0FBQ0YscUJBQXFCO0FBQ3JCLDZGQUE2RjtBQUM3RixvRUFBb0U7QUFDcEUsOEZBQThGO0FBQzlGLEVBQUU7QUFDRixFQUFFO0FBQ0YsTUFBTSxTQUFTLEdBQUcsQ0FBQyxDQUFDO0FBQ3BCLE1BQU0sU0FBUyxHQUFHLENBQUMsQ0FBQztBQUNwQixNQUFNLGFBQWEsR0FBRyxDQUFDLENBQUM7QUFDeEIsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO0FBQzNCLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxDQUFDO0FBRWhDLE1BQU0sa0JBQWtCLEdBQUc7SUFDekIsU0FBUztJQUNULFNBQVM7SUFDVCxhQUFhO0lBQ2IsWUFBWTtJQUNaLGdCQUFnQjtJQUNoQixxQkFBcUI7Q0FDdEIsQ0FBQztBQUVGLE1BQU0sWUFBWSxHQUFHLENBQUMsQ0FBQztBQUN2QixNQUFNLFdBQVcsR0FBRyxDQUFDLENBQUM7QUFDdEIsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFDO0FBRTlCLE1BQU0sdUJBQXVCLEdBQUc7SUFDOUIsWUFBWTtJQUNaLFdBQVc7SUFDWCxZQUFZO0lBQ1osbUJBQW1CO0NBQ3BCLENBQUM7QUFFRixNQUFhLGlCQUFpQjtJQUs1QixZQUFZLEtBQVUsRUFBRSxPQUFZO1FBQ2xDLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBRXZCLElBQUksQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxL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LGNBQXNCLEVBQUUsSUFBWTtRQUM1QyxNQUFNLG1CQUFtQixHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUVsQyxJQUFJLG1CQUFtQixDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUMsTUFBTSxFQUFFO1lBQ25ELE9BQU8sS0FBSyxDQUFDO1NBQ2Q7UUFFRCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQ25ELE1BQU0scUJBQXFCLEdBQUcsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckQsTUFBTSxXQUFXLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRWpDLElBQ0UscUJBQXFCLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQztnQkFDckMscUJBQXFCLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUNuQztnQkFDQSx3QkFBd0I7YUFDekI7aUJBQU07Z0JBQ0wsd0JBQXdCO2dCQUN4QixJQUFJLHFCQUFxQixLQUFLLFdBQVcsRUFBRTtvQkFDekMsT0FBTyxLQUFLLENBQUM7aUJBQ2Q7YUFDRjtTQUNGO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0NBQ0Y7QUE3TkQsOENBNk5DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgXyBmcm9tIFwibG9kYXNoXCI7XG5pbXBvcnQgeyBwZXJzb25hLCBQZXJzb25hQ2xpZW50IH0gZnJvbSBcInRhbGlzLW5vZGVcIjtcblxudHlwZSBQYXJzZWRBcm4gPSB7XG4gIG1ldGhvZDogc3RyaW5nO1xuICByZXNvdXJjZVBhdGg6IHN0cmluZztcbiAgYXBpT3B0aW9uczoge1xuICAgIHJlZ2lvbjogc3RyaW5nO1xuICAgIHJlc3RBcGlJZDogc3RyaW5nO1xuICAgIHN0YWdlOiBzdHJpbmc7XG4gIH07XG4gIGF3c0FjY291bnRJZDogc3RyaW5nO1xufTtcblxuLy8gQ29uc3RhbnRzIHVzZWQgYnkgcGFyc2VNZXRob2RBcm46XG4vL1xuLy8gRXhhbXBsZSBNZXRob2RBUk46XG4vLyAgIFwiYXJuOmF3czpleGVjdXRlLWFwaTo8UmVnaW9uIGlkPjo8QWNjb3VudCBpZD46PEFQSSBpZD4vPFN0YWdlPi88TWV0aG9kPi88UmVzb3VyY2UgcGF0aD5cIlxuLy8gTWV0aG9kIEFSTiBJbmRleDogIDAgICAxICAgMiAgICAgICAgICAgMyAgICAgICAgICAgNCAgICAgICAgICAgIDVcbi8vIEFQSSBHYXRld2F5IEFSTiBJbmRleDogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAwICAgICAgICAxICAgICAgIDIgICAgICAgIDNcbi8vXG4vL1xuY29uc3QgQVJOX0lOREVYID0gMDtcbmNvbnN0IEFXU19JTkRFWCA9IDE7XG5jb25zdCBFWEVDVVRFX0lOREVYID0gMjtcbmNvbnN0IFJFR0lPTl9JTkRFWCA9IDM7XG5jb25zdCBBQ0NPVU5UX0lEX0lOREVYID0gNDtcbmNvbnN0IEFQSV9HQVRFV0FZX0FSTl9JTkRFWCA9IDU7XG5cbmNvbnN0IE1FVEhPRF9BUk5fSU5ERVhFUyA9IFtcbiAgQVJOX0lOREVYLFxuICBBV1NfSU5ERVgsXG4gIEVYRUNVVEVfSU5ERVgsXG4gIFJFR0lPTl9JTkRFWCxcbiAgQUNDT1VOVF9JRF9JTkRFWCxcbiAgQVBJX0dBVEVXQVlfQVJOX0lOREVYLFxuXTtcblxuY29uc3QgQVBJX0lEX0lOREVYID0gMDtcbmNvbnN0IFNUQUdFX0lOREVYID0gMTtcbmNvbnN0IE1FVEhPRF9JTkRFWCA9IDI7XG5jb25zdCBSRVNPVVJDRV9QQVRIX0lOREVYID0gMztcblxuY29uc3QgQVBJX0dBVEVXQVlfQVJOX0lOREVYRVMgPSBbXG4gIEFQSV9JRF9JTkRFWCxcbiAgU1RBR0VfSU5ERVgsXG4gIE1FVEhPRF9JTkRFWCxcbiAgUkVTT1VSQ0VfUEFUSF9JTkRFWCxcbl07XG5cbmV4cG9ydCBjbGFzcyBQZXJzb25hQXV0aG9yaXplciB7XG4gIGV2ZW50OiBhbnk7XG4gIGNvbnRleHQ6IGFueTtcbiAgcGVyc29uYUNsaWVudDogUGVyc29uYUNsaWVudCB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihldmVudDogYW55LCBjb250ZXh0OiBhbnkpIHtcbiAgICB0aGlzLmV2ZW50ID0gZXZlbnQ7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcblxuICAgIHRoaXMucGVyc29uYUNsaWVudCA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGFzeW5jIGhhbmRsZSgpIHtcbiAgICBjb25zb2xlLmxvZyhcIlJlY2VpdmVkIGV2ZW50XCIsIHRoaXMuZXZlbnQpO1xuXG4gICAgaWYgKCF0aGlzLmV2ZW50Py5oZWFkZXJzIHx8IHRoaXMuZXZlbnQuaGVhZGVyc1tcImF1dGhvcml6YXRpb25cIl0gPT0gbnVsbCkge1xuICAgICAgY29uc29sZS5sb2coXCJNaXNzaW5nIGF1dGggdG9rZW5cIik7XG4gICAgICByZXR1cm4gdGhpcy5jb250ZXh0LmZhaWwoXCJVbmF1dGhvcml6ZWRcIik7XG4gICAgfVxuXG4gICAgY29uc3QgcGFyc2VkTWV0aG9kQXJuID0gdGhpcy5wYXJzZU1ldGhvZEFybih0aGlzLmV2ZW50LnJvdXRlQXJuKTtcbiAgICBjb25zb2xlLmxvZyhgUGFyc2VkIE1ldGhvZCBBcm46ICR7SlNPTi5zdHJpbmdpZnkocGFyc2VkTWV0aG9kQXJuKX1gKTtcblxuICAgIGNvbnN0IHNjb3BlID0gdGhpcy5nZXRTY29wZShwYXJzZWRNZXRob2RBcm4pO1xuICAgIGNvbnNvbGUubG9nKGBNZXRob2QgaGFzIHNjb3BlOiAke3Njb3BlfWApO1xuXG4gICAgbGV0IHZhbGlkYXRpb25PcHRzID0ge1xuICAgICAgdG9rZW46IF8ucmVwbGFjZShcbiAgICAgICAgdGhpcy5ldmVudC5oZWFkZXJzW1wiYXV0aG9yaXphdGlvblwiXSxcbiAgICAgICAgXCJCZWFyZXJcIixcbiAgICAgICAgXCJcIlxuICAgICAgKS50cmltKCksXG4gICAgfTtcbiAgICBpZiAoc2NvcGUgIT0gbnVsbCkge1xuICAgICAgdmFsaWRhdGlvbk9wdHMgPSBfLm1lcmdlKHZhbGlkYXRpb25PcHRzLCB7IHNjb3BlIH0pO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhgVmFsaWRhdGlvbiBvcHM6ICR7SlNPTi5zdHJpbmdpZnkodmFsaWRhdGlvbk9wdHMpfWApO1xuXG4gICAgY29uc29sZS5sb2coXG4gICAgICBcInZhbGlkYXRpbmcgdG9rZW4gYWdhaW5zdCByZXF1ZXN0XCIsXG4gICAgICBgJHtwYXJzZWRNZXRob2RBcm4ucmVzb3VyY2VQYXRofWBcbiAgICApO1xuXG4gICAgaWYgKCF2YWxpZGF0aW9uT3B0cy50b2tlbiB8fCB2YWxpZGF0aW9uT3B0cy50b2tlbi5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnNvbGUubG9nKFwidG9rZW4gbWlzc2luZ1wiKTtcbiAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuZmFpbChcIlVuYXV0aG9yaXplZFwiKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgdG9rZW4gPSBhd2FpdCB0aGlzLnZhbGlkYXRlVG9rZW4odmFsaWRhdGlvbk9wdHMpO1xuICAgICAgY29uc3Qgc3VjY2VzcyA9IHtcbiAgICAgICAgaXNBdXRob3JpemVkOiB0cnVlLFxuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgY2xpZW50SWQ6IHRva2VuW1wic3ViXCJdLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuc3VjY2VlZChzdWNjZXNzKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwidG9rZW4gdmFsaWRhdGlvbiBmYWlsZWRcIiwgZXJyKTtcblxuICAgICAgY29uc3QgZXJyb3IgPSBlcnIgYXMgeyBlcnJvcjogYW55OyB0b2tlbjogUmVjb3JkPHN0cmluZywgYW55PiB9O1xuXG4gICAgICBpZiAoZXJyb3IuZXJyb3IgPT09IHBlcnNvbmEuZXJyb3JUeXBlcy5JTlNVRkZJQ0lFTlRfU0NPUEUpIHtcbiAgICAgICAgY29uc3QgaW5zdWZmaWNpZW50U2NvcGUgPSB7XG4gICAgICAgICAgaXNBdXRob3JpemVkOiBmYWxzZSxcbiAgICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJJbnN1ZmZpY2llbnQgU2NvcGVcIixcbiAgICAgICAgICAgIGNsaWVudElkOiBlcnJvcj8udG9rZW4gPyBlcnJvci50b2tlbltcInN1YlwiXSA6IFwiXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5zdWNjZWVkKGluc3VmZmljaWVudFNjb3BlKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmFpbHVyZSA9IHtcbiAgICAgICAgaXNBdXRob3JpemVkOiBmYWxzZSxcbiAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgIGNsaWVudElkOiBlcnJvcj8udG9rZW4gPyBlcnJvci50b2tlbltcInN1YlwiXSA6IFwiXCIsXG4gICAgICAgIH0sXG4gICAgICB9O1xuICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5zdWNjZWVkKGZhaWx1cmUpO1xuICAgIH1cbiAgfVxuXG4gIHZhbGlkYXRlVG9rZW4odmFsaWRhdGlvbk9wdHM6IGFueSk6IFByb21pc2U8UmVjb3JkPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuZ2V0UGVyc29uYUNsaWVudCgpO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICBjbGllbnQudmFsaWRhdGVUb2tlbihcbiAgICAgICAgdmFsaWRhdGlvbk9wdHMsXG4gICAgICAgIChlcnJvcjogYW55LCBvazogYW55LCBkZWNvZGVkVG9rZW46IGFueSkgPT4ge1xuICAgICAgICAgIGlmIChlcnJvcikge1xuICAgICAgICAgICAgcmVqZWN0KHtcbiAgICAgICAgICAgICAgZXJyb3I6IGVycm9yLFxuICAgICAgICAgICAgICB0b2tlbjogZGVjb2RlZFRva2VuLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlc29sdmUoZGVjb2RlZFRva2VuKTtcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCcmVhayBkb3duIGFuIEFQSSBnYXRld2F5IG1ldGhvZCBBUk4gaW50byBpdCdzIGNvbnN0aXR1ZW50IHBhcnRzLlxuICAgKiBNZXRob2QgQVJOcyB0YWtlIHRoZSBmb2xsb3dpbmcgZm9ybWF0OlxuICAgKlxuICAgKiAgIGFybjphd3M6ZXhlY3V0ZS1hcGk6PFJlZ2lvbiBpZD46PEFjY291bnQgaWQ+OjxBUEkgaWQ+LzxTdGFnZT4vPE1ldGhvZD4vPFJlc291cmNlIHBhdGg+XG4gICAqXG4gICAqIGUuZzpcbiAgICpcbiAgICogICBhcm46YXdzOmV4ZWN1dGUtYXBpOmV1LXdlc3QtMToxMjM6YWJjL2RldmVsb3BtZW50L0dFVC8yL3dvcmtzXG4gICAqXG4gICAqIEBwYXJhbSBtZXRob2RBcm4ge3N0cmluZ30gVGhlIG1ldGhvZCBBUk4gcHJvdmlkZWQgYnkgdGhlIGV2ZW50IGhhbmRlZCB0byBhIExhbWJkYSBmdW5jdGlvblxuICAgKiBAcmV0dXJucyB7e1xuICAgKiAgIG1ldGhvZDogc3RyaW5nLFxuICAgKiAgIHJlc291cmNlUGF0aDogc3RyaW5nLFxuICAgKiAgIGFwaU9wdGlvbnM6IHtcbiAgICogICAgIHJlZ2lvbjogc3RyaW5nLFxuICAgKiAgICAgcmVzdEFwaUlkOiBzdHJpbmcsXG4gICAqICAgICBzdGFnZTogc3RyaW5nXG4gICAqICAgfSxcbiAgICogICBhd3NBY2NvdW50SWQ6IHN0cmluZ1xuICAgKiAgIH19XG4gICAqL1xuICBwYXJzZU1ldGhvZEFybihtZXRob2RBcm46IHN0cmluZyk6IFBhcnNlZEFybiB7XG4gICAgY29uc3QgbWV0aG9kQXJuUGFydHMgPSBtZXRob2RBcm4uc3BsaXQoXCI6XCIpO1xuICAgIGNvbnNvbGUubG9nKGBNZXRob2QgQVJOIFBhcnRzOiAke0pTT04uc3RyaW5naWZ5KG1ldGhvZEFyblBhcnRzKX1gKTtcbiAgICBsZXQgYXBpR2F0ZXdheUFybiA9IG1ldGhvZEFyblBhcnRzW0FQSV9HQVRFV0FZX0FSTl9JTkRFWF07XG4gICAgLy8gSWYgdGhlIHNwbGl0IGNyZWF0ZWQgbW9yZSB0aGFuIHRoZSBleHBlY3RlZCBudW1iZXIgb2YgcGFydHMsIHRoZW4gdGhlXG4gICAgLy8gYXBpR2F0ZXdheUFybiBtdXN0IGhhdmUgaGFkIG9uZSBvciBtb3JlIDoncyBpbiBpdC4gUmVjcmVhdGUgdGhlIGFwaUdhdGV3YXkgYXJuLlxuICAgIGZvciAoXG4gICAgICBsZXQgaW5kZXggPSBNRVRIT0RfQVJOX0lOREVYRVMubGVuZ3RoO1xuICAgICAgaW5kZXggPCBtZXRob2RBcm5QYXJ0cy5sZW5ndGg7XG4gICAgICBpbmRleCArPSAxXG4gICAgKSB7XG4gICAgICBhcGlHYXRld2F5QXJuICs9IGA6JHttZXRob2RBcm5QYXJ0c1tpbmRleF19YDtcbiAgICB9XG5cbiAgICBjb25zdCBhcGlHYXRld2F5QXJuUGFydHMgPSBhcGlHYXRld2F5QXJuLnNwbGl0KFwiL1wiKTtcbiAgICBjb25zb2xlLmxvZyhgYXBpIGdhdGV3YXkgYXJuIHBhcnRzOiAke0pTT04uc3RyaW5naWZ5KGFwaUdhdGV3YXlBcm5QYXJ0cyl9YCk7XG5cbiAgICAvLyBJZiB0aGUgc3BsaXQgY3JlYXRlZCBtb3JlIHRoYW4gdGhlIGV4cGVjdGVkIG51bWJlciBvZiBwYXJ0cywgdGhlbiB0aGVcbiAgICAvLyByZXNvdXJjZSBwYXRoIG11c3QgaGF2ZSBoYWQgb25lIG9yIG1vcmUgLydzIGluIGl0LiBSZWNyZWF0ZSB0aGUgcmVzb3VyY2UgcGF0aC5cbiAgICBsZXQgcmVzb3VyY2VQYXRoID0gXCJcIjtcbiAgICBmb3IgKFxuICAgICAgbGV0IGkgPSBBUElfR0FURVdBWV9BUk5fSU5ERVhFUy5sZW5ndGggLSAxO1xuICAgICAgaSA8IGFwaUdhdGV3YXlBcm5QYXJ0cy5sZW5ndGg7XG4gICAgICBpICs9IDFcbiAgICApIHtcbiAgICAgIHJlc291cmNlUGF0aCArPSBgLyR7YXBpR2F0ZXdheUFyblBhcnRzW2ldfWA7XG4gICAgfVxuICAgIGNvbnNvbGUubG9nKGByZXNvdXJjZSBwYXRoOiAke0pTT04uc3RyaW5naWZ5KHJlc291cmNlUGF0aCl9YCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1ldGhvZDogYXBpR2F0ZXdheUFyblBhcnRzW01FVEhPRF9JTkRFWF0sXG4gICAgICByZXNvdXJjZVBhdGgsXG4gICAgICBhcGlPcHRpb25zOiB7XG4gICAgICAgIHJlZ2lvbjogbWV0aG9kQXJuUGFydHNbUkVHSU9OX0lOREVYXSxcbiAgICAgICAgcmVzdEFwaUlkOiBhcGlHYXRld2F5QXJuUGFydHNbQVBJX0lEX0lOREVYXSxcbiAgICAgICAgc3RhZ2U6IGFwaUdhdGV3YXlBcm5QYXJ0c1tTVEFHRV9JTkRFWF0sXG4gICAgICB9LFxuICAgICAgYXdzQWNjb3VudElkOiBtZXRob2RBcm5QYXJ0c1tBQ0NPVU5UX0lEX0lOREVYXSxcbiAgICB9O1xuICB9XG5cbiAgZ2V0U2NvcGUocGFyc2VkTWV0aG9kQXJuOiBQYXJzZWRBcm4pIHtcbiAgICBjb25zdCBzY29wZUNvbmZpZyA9IHByb2Nlc3MuZW52W1wiU0NPUEVfQ09ORklHXCJdO1xuICAgIGlmIChzY29wZUNvbmZpZyAhPSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGNvbmYgPSBKU09OLnBhcnNlKHNjb3BlQ29uZmlnKTtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBPYmplY3Qua2V5cyhjb25mKSkge1xuICAgICAgICBpZiAodGhpcy5wYXRoTWF0Y2gocGF0aCwgcGFyc2VkTWV0aG9kQXJuLnJlc291cmNlUGF0aCkpIHtcbiAgICAgICAgICByZXR1cm4gY29uZltwYXRoXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGdldFBlcnNvbmFDbGllbnQoKSB7XG4gICAgaWYgKHRoaXMucGVyc29uYUNsaWVudCA9PSBudWxsKSB7XG4gICAgICBjb25zdCBwZXJzb25hQ29uZmlnID0ge1xuICAgICAgICBwZXJzb25hX2hvc3Q6IHByb2Nlc3MuZW52W1wiUEVSU09OQV9IT1NUXCJdLFxuICAgICAgICBwZXJzb25hX3NjaGVtZTogcHJvY2Vzcy5lbnZbXCJQRVJTT05BX1NDSEVNRVwiXSxcbiAgICAgICAgcGVyc29uYV9wb3J0OiBwcm9jZXNzLmVudltcIlBFUlNPTkFfUE9SVFwiXSxcbiAgICAgICAgcGVyc29uYV9vYXV0aF9yb3V0ZTogcHJvY2Vzcy5lbnZbXCJQRVJTT05BX09BVVRIX1JPVVRFXCJdLFxuICAgICAgfTtcblxuICAgICAgdGhpcy5wZXJzb25hQ2xpZW50ID0gcGVyc29uYS5jcmVhdGVDbGllbnQoXG4gICAgICAgIGAke3Byb2Nlc3MuZW52W1wiUEVSU09OQV9DTElFTlRfTkFNRVwiXX0gKGxhbWJkYTsgTk9ERV9FTlY9JHtwcm9jZXNzLmVudltcIk5PREVfRU5WXCJdfSlgLFxuICAgICAgICBfLm1lcmdlKHBlcnNvbmFDb25maWcsIHt9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5wZXJzb25hQ2xpZW50O1xuICB9XG5cbiAgcGF0aE1hdGNoKHBhdGhEZWZpbml0aW9uOiBzdHJpbmcsIHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHBhdGhEZWZpbml0aW9uUGFydHMgPSBwYXRoRGVmaW5pdGlvbi5zcGxpdChcIi9cIik7XG4gICAgY29uc3QgcGF0aFBhcnRzID0gcGF0aC5zcGxpdChcIi9cIik7XG5cbiAgICBpZiAocGF0aERlZmluaXRpb25QYXJ0cy5sZW5ndGggIT09IHBhdGhQYXJ0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhdGhEZWZpbml0aW9uUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IHBhdGhEZWZpbml0aW9uU2VnbWVudCA9IHBhdGhEZWZpbml0aW9uUGFydHNbaV07XG4gICAgICBjb25zdCBwYXRoU2VnbWVudCA9IHBhdGhQYXJ0c1tpXTtcblxuICAgICAgaWYgKFxuICAgICAgICBwYXRoRGVmaW5pdGlvblNlZ21lbnQuc3RhcnRzV2l0aChcIntcIikgJiZcbiAgICAgICAgcGF0aERlZmluaXRpb25TZWdtZW50LmVuZHNXaXRoKFwifVwiKVxuICAgICAgKSB7XG4gICAgICAgIC8vIE1hdGNoZXMgcGF0aCBhcmd1bWVudFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2hvdWxkIG1hdGNoIGRpcmVjdGx5XG4gICAgICAgIGlmIChwYXRoRGVmaW5pdGlvblNlZ21lbnQgIT09IHBhdGhTZWdtZW50KSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn1cbiJdfQ==