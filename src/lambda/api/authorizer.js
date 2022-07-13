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
module.exports.validateToken = async (event, context) => {
    const route = new PersonaAuthorizer(event, context);
    return await route.handle();
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aG9yaXplci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGhvcml6ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNEJBQTRCO0FBQzVCLDJDQUFvRDtBQWFwRCxvQ0FBb0M7QUFDcEMsRUFBRTtBQUNGLHFCQUFxQjtBQUNyQiw2RkFBNkY7QUFDN0Ysb0VBQW9FO0FBQ3BFLDhGQUE4RjtBQUM5RixFQUFFO0FBQ0YsRUFBRTtBQUNGLE1BQU0sU0FBUyxHQUFHLENBQUMsQ0FBQztBQUNwQixNQUFNLFNBQVMsR0FBRyxDQUFDLENBQUM7QUFDcEIsTUFBTSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLE1BQU0sWUFBWSxHQUFHLENBQUMsQ0FBQztBQUN2QixNQUFNLGdCQUFnQixHQUFHLENBQUMsQ0FBQztBQUMzQixNQUFNLHFCQUFxQixHQUFHLENBQUMsQ0FBQztBQUVoQyxNQUFNLGtCQUFrQixHQUFHO0lBQ3pCLFNBQVM7SUFDVCxTQUFTO0lBQ1QsYUFBYTtJQUNiLFlBQVk7SUFDWixnQkFBZ0I7SUFDaEIscUJBQXFCO0NBQ3RCLENBQUM7QUFFRixNQUFNLFlBQVksR0FBRyxDQUFDLENBQUM7QUFDdkIsTUFBTSxXQUFXLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLE1BQU0sWUFBWSxHQUFHLENBQUMsQ0FBQztBQUN2QixNQUFNLG1CQUFtQixHQUFHLENBQUMsQ0FBQztBQUU5QixNQUFNLHVCQUF1QixHQUFHO0lBQzlCLFlBQVk7SUFDWixXQUFXO0lBQ1gsWUFBWTtJQUNaLG1CQUFtQjtDQUNwQixDQUFDO0FBRUYsTUFBYSxpQkFBaUI7SUFLNUIsWUFBWSxLQUFVLEVBQUUsT0FBWTtRQUNsQyxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNuQixJQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztRQUV2QixJQUFJLENBQUMsYUFBYSxHQUFHLFNBQVMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU07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QUFNLG1CQUFtQixHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDdEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUVsQyxJQUFJLG1CQUFtQixDQUFDLE1BQU0sS0FBSyxTQUFTLENBQUMsTUFBTSxFQUFFO1lBQ25ELE9BQU8sS0FBSyxDQUFDO1NBQ2Q7UUFFRCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsbUJBQW1CLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO1lBQ25ELE1BQU0scUJBQXFCLEdBQUcsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckQsTUFBTSxXQUFXLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBRWpDLElBQ0UscUJBQXFCLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQztnQkFDckMscUJBQXFCLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxFQUNuQztnQkFDQSx3QkFBd0I7YUFDekI7aUJBQU07Z0JBQ0wsd0JBQXdCO2dCQUN4QixJQUFJLHFCQUFxQixLQUFLLFdBQVcsRUFBRTtvQkFDekMsT0FBTyxLQUFLLENBQUM7aUJBQ2Q7YUFDRjtTQUNGO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0NBQ0Y7QUE3TkQsOENBNk5DO0FBRUQsTUFBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsS0FBSyxFQUFFLEtBQVUsRUFBRSxPQUFZLEVBQUUsRUFBRTtJQUNoRSxNQUFNLEtBQUssR0FBRyxJQUFJLGlCQUFpQixDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNwRCxPQUFPLE1BQU0sS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO0FBQzlCLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIF8gZnJvbSBcImxvZGFzaFwiO1xuaW1wb3J0IHsgcGVyc29uYSwgUGVyc29uYUNsaWVudCB9IGZyb20gXCJ0YWxpcy1ub2RlXCI7XG5cbnR5cGUgUGFyc2VkQXJuID0ge1xuICBtZXRob2Q6IHN0cmluZztcbiAgcmVzb3VyY2VQYXRoOiBzdHJpbmc7XG4gIGFwaU9wdGlvbnM6IHtcbiAgICByZWdpb246IHN0cmluZztcbiAgICByZXN0QXBpSWQ6IHN0cmluZztcbiAgICBzdGFnZTogc3RyaW5nO1xuICB9O1xuICBhd3NBY2NvdW50SWQ6IHN0cmluZztcbn07XG5cbi8vIENvbnN0YW50cyB1c2VkIGJ5IHBhcnNlTWV0aG9kQXJuOlxuLy9cbi8vIEV4YW1wbGUgTWV0aG9kQVJOOlxuLy8gICBcImFybjphd3M6ZXhlY3V0ZS1hcGk6PFJlZ2lvbiBpZD46PEFjY291bnQgaWQ+OjxBUEkgaWQ+LzxTdGFnZT4vPE1ldGhvZD4vPFJlc291cmNlIHBhdGg+XCJcbi8vIE1ldGhvZCBBUk4gSW5kZXg6ICAwICAgMSAgIDIgICAgICAgICAgIDMgICAgICAgICAgIDQgICAgICAgICAgICA1XG4vLyBBUEkgR2F0ZXdheSBBUk4gSW5kZXg6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgMCAgICAgICAgMSAgICAgICAyICAgICAgICAzXG4vL1xuLy9cbmNvbnN0IEFSTl9JTkRFWCA9IDA7XG5jb25zdCBBV1NfSU5ERVggPSAxO1xuY29uc3QgRVhFQ1VURV9JTkRFWCA9IDI7XG5jb25zdCBSRUdJT05fSU5ERVggPSAzO1xuY29uc3QgQUNDT1VOVF9JRF9JTkRFWCA9IDQ7XG5jb25zdCBBUElfR0FURVdBWV9BUk5fSU5ERVggPSA1O1xuXG5jb25zdCBNRVRIT0RfQVJOX0lOREVYRVMgPSBbXG4gIEFSTl9JTkRFWCxcbiAgQVdTX0lOREVYLFxuICBFWEVDVVRFX0lOREVYLFxuICBSRUdJT05fSU5ERVgsXG4gIEFDQ09VTlRfSURfSU5ERVgsXG4gIEFQSV9HQVRFV0FZX0FSTl9JTkRFWCxcbl07XG5cbmNvbnN0IEFQSV9JRF9JTkRFWCA9IDA7XG5jb25zdCBTVEFHRV9JTkRFWCA9IDE7XG5jb25zdCBNRVRIT0RfSU5ERVggPSAyO1xuY29uc3QgUkVTT1VSQ0VfUEFUSF9JTkRFWCA9IDM7XG5cbmNvbnN0IEFQSV9HQVRFV0FZX0FSTl9JTkRFWEVTID0gW1xuICBBUElfSURfSU5ERVgsXG4gIFNUQUdFX0lOREVYLFxuICBNRVRIT0RfSU5ERVgsXG4gIFJFU09VUkNFX1BBVEhfSU5ERVgsXG5dO1xuXG5leHBvcnQgY2xhc3MgUGVyc29uYUF1dGhvcml6ZXIge1xuICBldmVudDogYW55O1xuICBjb250ZXh0OiBhbnk7XG4gIHBlcnNvbmFDbGllbnQ6IFBlcnNvbmFDbGllbnQgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoZXZlbnQ6IGFueSwgY29udGV4dDogYW55KSB7XG4gICAgdGhpcy5ldmVudCA9IGV2ZW50O1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG5cbiAgICB0aGlzLnBlcnNvbmFDbGllbnQgPSB1bmRlZmluZWQ7XG4gIH1cblxuICBhc3luYyBoYW5kbGUoKSB7XG4gICAgY29uc29sZS5sb2coXCJSZWNlaXZlZCBldmVudFwiLCB0aGlzLmV2ZW50KTtcblxuICAgIGlmICghdGhpcy5ldmVudD8uaGVhZGVycyB8fCB0aGlzLmV2ZW50LmhlYWRlcnNbXCJhdXRob3JpemF0aW9uXCJdID09IG51bGwpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiTWlzc2luZyBhdXRoIHRva2VuXCIpO1xuICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5mYWlsKFwiVW5hdXRob3JpemVkXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZE1ldGhvZEFybiA9IHRoaXMucGFyc2VNZXRob2RBcm4odGhpcy5ldmVudC5yb3V0ZUFybik7XG4gICAgY29uc29sZS5sb2coYFBhcnNlZCBNZXRob2QgQXJuOiAke0pTT04uc3RyaW5naWZ5KHBhcnNlZE1ldGhvZEFybil9YCk7XG5cbiAgICBjb25zdCBzY29wZSA9IHRoaXMuZ2V0U2NvcGUocGFyc2VkTWV0aG9kQXJuKTtcbiAgICBjb25zb2xlLmxvZyhgTWV0aG9kIGhhcyBzY29wZTogJHtzY29wZX1gKTtcblxuICAgIGxldCB2YWxpZGF0aW9uT3B0cyA9IHtcbiAgICAgIHRva2VuOiBfLnJlcGxhY2UoXG4gICAgICAgIHRoaXMuZXZlbnQuaGVhZGVyc1tcImF1dGhvcml6YXRpb25cIl0sXG4gICAgICAgIFwiQmVhcmVyXCIsXG4gICAgICAgIFwiXCJcbiAgICAgICkudHJpbSgpLFxuICAgIH07XG4gICAgaWYgKHNjb3BlICE9IG51bGwpIHtcbiAgICAgIHZhbGlkYXRpb25PcHRzID0gXy5tZXJnZSh2YWxpZGF0aW9uT3B0cywgeyBzY29wZSB9KTtcbiAgICB9XG4gICAgY29uc29sZS5sb2coYFZhbGlkYXRpb24gb3BzOiAke0pTT04uc3RyaW5naWZ5KHZhbGlkYXRpb25PcHRzKX1gKTtcblxuICAgIGNvbnNvbGUubG9nKFxuICAgICAgXCJ2YWxpZGF0aW5nIHRva2VuIGFnYWluc3QgcmVxdWVzdFwiLFxuICAgICAgYCR7cGFyc2VkTWV0aG9kQXJuLnJlc291cmNlUGF0aH1gXG4gICAgKTtcblxuICAgIGlmICghdmFsaWRhdGlvbk9wdHMudG9rZW4gfHwgdmFsaWRhdGlvbk9wdHMudG9rZW4ubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhcInRva2VuIG1pc3NpbmdcIik7XG4gICAgICByZXR1cm4gdGhpcy5jb250ZXh0LmZhaWwoXCJVbmF1dGhvcml6ZWRcIik7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRva2VuID0gYXdhaXQgdGhpcy52YWxpZGF0ZVRva2VuKHZhbGlkYXRpb25PcHRzKTtcbiAgICAgIGNvbnN0IHN1Y2Nlc3MgPSB7XG4gICAgICAgIGlzQXV0aG9yaXplZDogdHJ1ZSxcbiAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgIGNsaWVudElkOiB0b2tlbltcInN1YlwiXSxcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5jb250ZXh0LnN1Y2NlZWQoc3VjY2Vzcyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmxvZyhcInRva2VuIHZhbGlkYXRpb24gZmFpbGVkXCIsIGVycik7XG5cbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGFzIHsgZXJyb3I6IGFueTsgdG9rZW46IFJlY29yZDxzdHJpbmcsIGFueT4gfTtcblxuICAgICAgaWYgKGVycm9yLmVycm9yID09PSBwZXJzb25hLmVycm9yVHlwZXMuSU5TVUZGSUNJRU5UX1NDT1BFKSB7XG4gICAgICAgIGNvbnN0IGluc3VmZmljaWVudFNjb3BlID0ge1xuICAgICAgICAgIGlzQXV0aG9yaXplZDogZmFsc2UsXG4gICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiSW5zdWZmaWNpZW50IFNjb3BlXCIsXG4gICAgICAgICAgICBjbGllbnRJZDogZXJyb3I/LnRva2VuID8gZXJyb3IudG9rZW5bXCJzdWJcIl0gOiBcIlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuc3VjY2VlZChpbnN1ZmZpY2llbnRTY29wZSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZhaWx1cmUgPSB7XG4gICAgICAgIGlzQXV0aG9yaXplZDogZmFsc2UsXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICBjbGllbnRJZDogZXJyb3I/LnRva2VuID8gZXJyb3IudG9rZW5bXCJzdWJcIl0gOiBcIlwiLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuc3VjY2VlZChmYWlsdXJlKTtcbiAgICB9XG4gIH1cblxuICB2YWxpZGF0ZVRva2VuKHZhbGlkYXRpb25PcHRzOiBhbnkpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmdldFBlcnNvbmFDbGllbnQoKTtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgY2xpZW50LnZhbGlkYXRlVG9rZW4oXG4gICAgICAgIHZhbGlkYXRpb25PcHRzLFxuICAgICAgICAoZXJyb3I6IGFueSwgb2s6IGFueSwgZGVjb2RlZFRva2VuOiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJlamVjdCh7XG4gICAgICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICAgICAgdG9rZW46IGRlY29kZWRUb2tlbixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXNvbHZlKGRlY29kZWRUb2tlbik7XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQnJlYWsgZG93biBhbiBBUEkgZ2F0ZXdheSBtZXRob2QgQVJOIGludG8gaXQncyBjb25zdGl0dWVudCBwYXJ0cy5cbiAgICogTWV0aG9kIEFSTnMgdGFrZSB0aGUgZm9sbG93aW5nIGZvcm1hdDpcbiAgICpcbiAgICogICBhcm46YXdzOmV4ZWN1dGUtYXBpOjxSZWdpb24gaWQ+OjxBY2NvdW50IGlkPjo8QVBJIGlkPi88U3RhZ2U+LzxNZXRob2Q+LzxSZXNvdXJjZSBwYXRoPlxuICAgKlxuICAgKiBlLmc6XG4gICAqXG4gICAqICAgYXJuOmF3czpleGVjdXRlLWFwaTpldS13ZXN0LTE6MTIzOmFiYy9kZXZlbG9wbWVudC9HRVQvMi93b3Jrc1xuICAgKlxuICAgKiBAcGFyYW0gbWV0aG9kQXJuIHtzdHJpbmd9IFRoZSBtZXRob2QgQVJOIHByb3ZpZGVkIGJ5IHRoZSBldmVudCBoYW5kZWQgdG8gYSBMYW1iZGEgZnVuY3Rpb25cbiAgICogQHJldHVybnMge3tcbiAgICogICBtZXRob2Q6IHN0cmluZyxcbiAgICogICByZXNvdXJjZVBhdGg6IHN0cmluZyxcbiAgICogICBhcGlPcHRpb25zOiB7XG4gICAqICAgICByZWdpb246IHN0cmluZyxcbiAgICogICAgIHJlc3RBcGlJZDogc3RyaW5nLFxuICAgKiAgICAgc3RhZ2U6IHN0cmluZ1xuICAgKiAgIH0sXG4gICAqICAgYXdzQWNjb3VudElkOiBzdHJpbmdcbiAgICogICB9fVxuICAgKi9cbiAgcGFyc2VNZXRob2RBcm4obWV0aG9kQXJuOiBzdHJpbmcpOiBQYXJzZWRBcm4ge1xuICAgIGNvbnN0IG1ldGhvZEFyblBhcnRzID0gbWV0aG9kQXJuLnNwbGl0KFwiOlwiKTtcbiAgICBjb25zb2xlLmxvZyhgTWV0aG9kIEFSTiBQYXJ0czogJHtKU09OLnN0cmluZ2lmeShtZXRob2RBcm5QYXJ0cyl9YCk7XG4gICAgbGV0IGFwaUdhdGV3YXlBcm4gPSBtZXRob2RBcm5QYXJ0c1tBUElfR0FURVdBWV9BUk5fSU5ERVhdO1xuICAgIC8vIElmIHRoZSBzcGxpdCBjcmVhdGVkIG1vcmUgdGhhbiB0aGUgZXhwZWN0ZWQgbnVtYmVyIG9mIHBhcnRzLCB0aGVuIHRoZVxuICAgIC8vIGFwaUdhdGV3YXlBcm4gbXVzdCBoYXZlIGhhZCBvbmUgb3IgbW9yZSA6J3MgaW4gaXQuIFJlY3JlYXRlIHRoZSBhcGlHYXRld2F5IGFybi5cbiAgICBmb3IgKFxuICAgICAgbGV0IGluZGV4ID0gTUVUSE9EX0FSTl9JTkRFWEVTLmxlbmd0aDtcbiAgICAgIGluZGV4IDwgbWV0aG9kQXJuUGFydHMubGVuZ3RoO1xuICAgICAgaW5kZXggKz0gMVxuICAgICkge1xuICAgICAgYXBpR2F0ZXdheUFybiArPSBgOiR7bWV0aG9kQXJuUGFydHNbaW5kZXhdfWA7XG4gICAgfVxuXG4gICAgY29uc3QgYXBpR2F0ZXdheUFyblBhcnRzID0gYXBpR2F0ZXdheUFybi5zcGxpdChcIi9cIik7XG4gICAgY29uc29sZS5sb2coYGFwaSBnYXRld2F5IGFybiBwYXJ0czogJHtKU09OLnN0cmluZ2lmeShhcGlHYXRld2F5QXJuUGFydHMpfWApO1xuXG4gICAgLy8gSWYgdGhlIHNwbGl0IGNyZWF0ZWQgbW9yZSB0aGFuIHRoZSBleHBlY3RlZCBudW1iZXIgb2YgcGFydHMsIHRoZW4gdGhlXG4gICAgLy8gcmVzb3VyY2UgcGF0aCBtdXN0IGhhdmUgaGFkIG9uZSBvciBtb3JlIC8ncyBpbiBpdC4gUmVjcmVhdGUgdGhlIHJlc291cmNlIHBhdGguXG4gICAgbGV0IHJlc291cmNlUGF0aCA9IFwiXCI7XG4gICAgZm9yIChcbiAgICAgIGxldCBpID0gQVBJX0dBVEVXQVlfQVJOX0lOREVYRVMubGVuZ3RoIC0gMTtcbiAgICAgIGkgPCBhcGlHYXRld2F5QXJuUGFydHMubGVuZ3RoO1xuICAgICAgaSArPSAxXG4gICAgKSB7XG4gICAgICByZXNvdXJjZVBhdGggKz0gYC8ke2FwaUdhdGV3YXlBcm5QYXJ0c1tpXX1gO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhgcmVzb3VyY2UgcGF0aDogJHtKU09OLnN0cmluZ2lmeShyZXNvdXJjZVBhdGgpfWApO1xuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IGFwaUdhdGV3YXlBcm5QYXJ0c1tNRVRIT0RfSU5ERVhdLFxuICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICByZWdpb246IG1ldGhvZEFyblBhcnRzW1JFR0lPTl9JTkRFWF0sXG4gICAgICAgIHJlc3RBcGlJZDogYXBpR2F0ZXdheUFyblBhcnRzW0FQSV9JRF9JTkRFWF0sXG4gICAgICAgIHN0YWdlOiBhcGlHYXRld2F5QXJuUGFydHNbU1RBR0VfSU5ERVhdLFxuICAgICAgfSxcbiAgICAgIGF3c0FjY291bnRJZDogbWV0aG9kQXJuUGFydHNbQUNDT1VOVF9JRF9JTkRFWF0sXG4gICAgfTtcbiAgfVxuXG4gIGdldFNjb3BlKHBhcnNlZE1ldGhvZEFybjogUGFyc2VkQXJuKSB7XG4gICAgY29uc3Qgc2NvcGVDb25maWcgPSBwcm9jZXNzLmVudltcIlNDT1BFX0NPTkZJR1wiXTtcbiAgICBpZiAoc2NvcGVDb25maWcgIT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBjb25mID0gSlNPTi5wYXJzZShzY29wZUNvbmZpZyk7XG4gICAgICBmb3IgKGNvbnN0IHBhdGggb2YgT2JqZWN0LmtleXMoY29uZikpIHtcbiAgICAgICAgaWYgKHRoaXMucGF0aE1hdGNoKHBhdGgsIHBhcnNlZE1ldGhvZEFybi5yZXNvdXJjZVBhdGgpKSB7XG4gICAgICAgICAgcmV0dXJuIGNvbmZbcGF0aF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRQZXJzb25hQ2xpZW50KCkge1xuICAgIGlmICh0aGlzLnBlcnNvbmFDbGllbnQgPT0gbnVsbCkge1xuICAgICAgY29uc3QgcGVyc29uYUNvbmZpZyA9IHtcbiAgICAgICAgcGVyc29uYV9ob3N0OiBwcm9jZXNzLmVudltcIlBFUlNPTkFfSE9TVFwiXSxcbiAgICAgICAgcGVyc29uYV9zY2hlbWU6IHByb2Nlc3MuZW52W1wiUEVSU09OQV9TQ0hFTUVcIl0sXG4gICAgICAgIHBlcnNvbmFfcG9ydDogcHJvY2Vzcy5lbnZbXCJQRVJTT05BX1BPUlRcIl0sXG4gICAgICAgIHBlcnNvbmFfb2F1dGhfcm91dGU6IHByb2Nlc3MuZW52W1wiUEVSU09OQV9PQVVUSF9ST1VURVwiXSxcbiAgICAgIH07XG5cbiAgICAgIHRoaXMucGVyc29uYUNsaWVudCA9IHBlcnNvbmEuY3JlYXRlQ2xpZW50KFxuICAgICAgICBgJHtwcm9jZXNzLmVudltcIlBFUlNPTkFfQ0xJRU5UX05BTUVcIl19IChsYW1iZGE7IE5PREVfRU5WPSR7cHJvY2Vzcy5lbnZbXCJOT0RFX0VOVlwiXX0pYCxcbiAgICAgICAgXy5tZXJnZShwZXJzb25hQ29uZmlnLCB7fSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGVyc29uYUNsaWVudDtcbiAgfVxuXG4gIHBhdGhNYXRjaChwYXRoRGVmaW5pdGlvbjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBwYXRoRGVmaW5pdGlvblBhcnRzID0gcGF0aERlZmluaXRpb24uc3BsaXQoXCIvXCIpO1xuICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGguc3BsaXQoXCIvXCIpO1xuXG4gICAgaWYgKHBhdGhEZWZpbml0aW9uUGFydHMubGVuZ3RoICE9PSBwYXRoUGFydHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXRoRGVmaW5pdGlvblBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwYXRoRGVmaW5pdGlvblNlZ21lbnQgPSBwYXRoRGVmaW5pdGlvblBhcnRzW2ldO1xuICAgICAgY29uc3QgcGF0aFNlZ21lbnQgPSBwYXRoUGFydHNbaV07XG5cbiAgICAgIGlmIChcbiAgICAgICAgcGF0aERlZmluaXRpb25TZWdtZW50LnN0YXJ0c1dpdGgoXCJ7XCIpICYmXG4gICAgICAgIHBhdGhEZWZpbml0aW9uU2VnbWVudC5lbmRzV2l0aChcIn1cIilcbiAgICAgICkge1xuICAgICAgICAvLyBNYXRjaGVzIHBhdGggYXJndW1lbnRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFNob3VsZCBtYXRjaCBkaXJlY3RseVxuICAgICAgICBpZiAocGF0aERlZmluaXRpb25TZWdtZW50ICE9PSBwYXRoU2VnbWVudCkge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzLnZhbGlkYXRlVG9rZW4gPSBhc3luYyAoZXZlbnQ6IGFueSwgY29udGV4dDogYW55KSA9PiB7XG4gIGNvbnN0IHJvdXRlID0gbmV3IFBlcnNvbmFBdXRob3JpemVyKGV2ZW50LCBjb250ZXh0KTtcbiAgcmV0dXJuIGF3YWl0IHJvdXRlLmhhbmRsZSgpO1xufTtcbiJdfQ==