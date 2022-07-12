"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
    pathMatch(pathDefination, path) {
        const pathDefinationParts = pathDefination.split("/");
        const pathParts = pathDefination.split("/");
        if (pathDefinationParts.length != pathParts.length) {
            return false;
        }
        for (let i = 0; i < pathDefinationParts.length; i++) {
            const pathDefinitionSegment = pathDefinationParts[i];
            const pathSegment = pathParts[i];
            if (pathDefination.startsWith("{") && pathDefination.endsWith("}")) {
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
module.exports.validateToken = async (event, context) => {
    const route = new PersonaAuthorizer(event, context);
    return await route.handle();
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0aG9yaXplci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImF1dGhvcml6ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSw0QkFBNEI7QUFDNUIsMkNBQW9EO0FBYXBELG9DQUFvQztBQUNwQyxFQUFFO0FBQ0YscUJBQXFCO0FBQ3JCLDZGQUE2RjtBQUM3RixvRUFBb0U7QUFDcEUsOEZBQThGO0FBQzlGLEVBQUU7QUFDRixFQUFFO0FBQ0YsTUFBTSxTQUFTLEdBQUcsQ0FBQyxDQUFDO0FBQ3BCLE1BQU0sU0FBUyxHQUFHLENBQUMsQ0FBQztBQUNwQixNQUFNLGFBQWEsR0FBRyxDQUFDLENBQUM7QUFDeEIsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLE1BQU0sZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO0FBQzNCLE1BQU0scUJBQXFCLEdBQUcsQ0FBQyxDQUFDO0FBRWhDLE1BQU0sa0JBQWtCLEdBQUc7SUFDekIsU0FBUztJQUNULFNBQVM7SUFDVCxhQUFhO0lBQ2IsWUFBWTtJQUNaLGdCQUFnQjtJQUNoQixxQkFBcUI7Q0FDdEIsQ0FBQztBQUVGLE1BQU0sWUFBWSxHQUFHLENBQUMsQ0FBQztBQUN2QixNQUFNLFdBQVcsR0FBRyxDQUFDLENBQUM7QUFDdEIsTUFBTSxZQUFZLEdBQUcsQ0FBQyxDQUFDO0FBQ3ZCLE1BQU0sbUJBQW1CLEdBQUcsQ0FBQyxDQUFDO0FBRTlCLE1BQU0sdUJBQXVCLEdBQUc7SUFDOUIsWUFBWTtJQUNaLFdBQVc7SUFDWCxZQUFZO0lBQ1osbUJBQW1CO0NBQ3BCLENBQUM7QUFFRixNQUFNLGlCQUFpQjtJQUtyQixZQUFZLEtBQVUsRUFBRSxPQUFZO1FBQ2xDLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBRXZCLElBQUksQ0FBQyxhQUFhLEdBQUcsU0FBUyxDQUFDO0lBQ2pDLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTTs7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QU0sbUJBQW1CLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN0RCxNQUFNLFNBQVMsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBRTVDLElBQUksbUJBQW1CLENBQUMsTUFBTSxJQUFJLFNBQVMsQ0FBQyxNQUFNLEVBQUU7WUFDbEQsT0FBTyxLQUFLLENBQUM7U0FDZDtRQUVELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxtQkFBbUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDbkQsTUFBTSxxQkFBcUIsR0FBRyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNyRCxNQUFNLFdBQVcsR0FBRyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFFakMsSUFBSSxjQUFjLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUU7Z0JBQ2xFLHdCQUF3QjthQUN6QjtpQkFBTTtnQkFDTCx3QkFBd0I7Z0JBQ3hCLElBQUkscUJBQXFCLEtBQUssV0FBVyxFQUFFO29CQUN6QyxPQUFPLEtBQUssQ0FBQztpQkFDZDthQUNGO1NBQ0Y7UUFFRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7Q0FDRjtBQUVELE1BQU0sQ0FBQyxPQUFPLENBQUMsYUFBYSxHQUFHLEtBQUssRUFBRSxLQUFVLEVBQUUsT0FBWSxFQUFFLEVBQUU7SUFDaEUsTUFBTSxLQUFLLEdBQUcsSUFBSSxpQkFBaUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDcEQsT0FBTyxNQUFNLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztBQUM5QixDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBfIGZyb20gXCJsb2Rhc2hcIjtcbmltcG9ydCB7IHBlcnNvbmEsIFBlcnNvbmFDbGllbnQgfSBmcm9tIFwidGFsaXMtbm9kZVwiO1xuXG50eXBlIFBhcnNlZEFybiA9IHtcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIHJlc291cmNlUGF0aDogc3RyaW5nO1xuICBhcGlPcHRpb25zOiB7XG4gICAgcmVnaW9uOiBzdHJpbmc7XG4gICAgcmVzdEFwaUlkOiBzdHJpbmc7XG4gICAgc3RhZ2U6IHN0cmluZztcbiAgfTtcbiAgYXdzQWNjb3VudElkOiBzdHJpbmc7XG59O1xuXG4vLyBDb25zdGFudHMgdXNlZCBieSBwYXJzZU1ldGhvZEFybjpcbi8vXG4vLyBFeGFtcGxlIE1ldGhvZEFSTjpcbi8vICAgXCJhcm46YXdzOmV4ZWN1dGUtYXBpOjxSZWdpb24gaWQ+OjxBY2NvdW50IGlkPjo8QVBJIGlkPi88U3RhZ2U+LzxNZXRob2Q+LzxSZXNvdXJjZSBwYXRoPlwiXG4vLyBNZXRob2QgQVJOIEluZGV4OiAgMCAgIDEgICAyICAgICAgICAgICAzICAgICAgICAgICA0ICAgICAgICAgICAgNVxuLy8gQVBJIEdhdGV3YXkgQVJOIEluZGV4OiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDAgICAgICAgIDEgICAgICAgMiAgICAgICAgM1xuLy9cbi8vXG5jb25zdCBBUk5fSU5ERVggPSAwO1xuY29uc3QgQVdTX0lOREVYID0gMTtcbmNvbnN0IEVYRUNVVEVfSU5ERVggPSAyO1xuY29uc3QgUkVHSU9OX0lOREVYID0gMztcbmNvbnN0IEFDQ09VTlRfSURfSU5ERVggPSA0O1xuY29uc3QgQVBJX0dBVEVXQVlfQVJOX0lOREVYID0gNTtcblxuY29uc3QgTUVUSE9EX0FSTl9JTkRFWEVTID0gW1xuICBBUk5fSU5ERVgsXG4gIEFXU19JTkRFWCxcbiAgRVhFQ1VURV9JTkRFWCxcbiAgUkVHSU9OX0lOREVYLFxuICBBQ0NPVU5UX0lEX0lOREVYLFxuICBBUElfR0FURVdBWV9BUk5fSU5ERVgsXG5dO1xuXG5jb25zdCBBUElfSURfSU5ERVggPSAwO1xuY29uc3QgU1RBR0VfSU5ERVggPSAxO1xuY29uc3QgTUVUSE9EX0lOREVYID0gMjtcbmNvbnN0IFJFU09VUkNFX1BBVEhfSU5ERVggPSAzO1xuXG5jb25zdCBBUElfR0FURVdBWV9BUk5fSU5ERVhFUyA9IFtcbiAgQVBJX0lEX0lOREVYLFxuICBTVEFHRV9JTkRFWCxcbiAgTUVUSE9EX0lOREVYLFxuICBSRVNPVVJDRV9QQVRIX0lOREVYLFxuXTtcblxuY2xhc3MgUGVyc29uYUF1dGhvcml6ZXIge1xuICBldmVudDogYW55O1xuICBjb250ZXh0OiBhbnk7XG4gIHBlcnNvbmFDbGllbnQ6IFBlcnNvbmFDbGllbnQgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IoZXZlbnQ6IGFueSwgY29udGV4dDogYW55KSB7XG4gICAgdGhpcy5ldmVudCA9IGV2ZW50O1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG5cbiAgICB0aGlzLnBlcnNvbmFDbGllbnQgPSB1bmRlZmluZWQ7XG4gIH1cblxuICBhc3luYyBoYW5kbGUoKSB7XG4gICAgY29uc29sZS5sb2coXCJSZWNlaXZlZCBldmVudFwiLCB0aGlzLmV2ZW50KTtcblxuICAgIGlmICghdGhpcy5ldmVudD8uaGVhZGVycyB8fCB0aGlzLmV2ZW50LmhlYWRlcnNbXCJhdXRob3JpemF0aW9uXCJdID09IG51bGwpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiTWlzc2luZyBhdXRoIHRva2VuXCIpO1xuICAgICAgcmV0dXJuIHRoaXMuY29udGV4dC5mYWlsKFwiVW5hdXRob3JpemVkXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZE1ldGhvZEFybiA9IHRoaXMucGFyc2VNZXRob2RBcm4odGhpcy5ldmVudC5yb3V0ZUFybik7XG4gICAgY29uc29sZS5sb2coYFBhcnNlZCBNZXRob2QgQXJuOiAke0pTT04uc3RyaW5naWZ5KHBhcnNlZE1ldGhvZEFybil9YCk7XG5cbiAgICBjb25zdCBzY29wZSA9IHRoaXMuZ2V0U2NvcGUocGFyc2VkTWV0aG9kQXJuKTtcbiAgICBjb25zb2xlLmxvZyhgTWV0aG9kIGhhcyBzY29wZTogJHtzY29wZX1gKTtcblxuICAgIGxldCB2YWxpZGF0aW9uT3B0cyA9IHtcbiAgICAgIHRva2VuOiBfLnJlcGxhY2UoXG4gICAgICAgIHRoaXMuZXZlbnQuaGVhZGVyc1tcImF1dGhvcml6YXRpb25cIl0sXG4gICAgICAgIFwiQmVhcmVyXCIsXG4gICAgICAgIFwiXCJcbiAgICAgICkudHJpbSgpLFxuICAgIH07XG4gICAgaWYgKHNjb3BlICE9IG51bGwpIHtcbiAgICAgIHZhbGlkYXRpb25PcHRzID0gXy5tZXJnZSh2YWxpZGF0aW9uT3B0cywgeyBzY29wZSB9KTtcbiAgICB9XG4gICAgY29uc29sZS5sb2coYFZhbGlkYXRpb24gb3BzOiAke0pTT04uc3RyaW5naWZ5KHZhbGlkYXRpb25PcHRzKX1gKTtcblxuICAgIGNvbnNvbGUubG9nKFxuICAgICAgXCJ2YWxpZGF0aW5nIHRva2VuIGFnYWluc3QgcmVxdWVzdFwiLFxuICAgICAgYCR7cGFyc2VkTWV0aG9kQXJuLnJlc291cmNlUGF0aH1gXG4gICAgKTtcblxuICAgIGlmICghdmFsaWRhdGlvbk9wdHMudG9rZW4gfHwgdmFsaWRhdGlvbk9wdHMudG9rZW4ubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zb2xlLmxvZyhcInRva2VuIG1pc3NpbmdcIik7XG4gICAgICByZXR1cm4gdGhpcy5jb250ZXh0LmZhaWwoXCJVbmF1dGhvcml6ZWRcIik7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRva2VuID0gYXdhaXQgdGhpcy52YWxpZGF0ZVRva2VuKHZhbGlkYXRpb25PcHRzKTtcbiAgICAgIGNvbnN0IHN1Y2Nlc3MgPSB7XG4gICAgICAgIGlzQXV0aG9yaXplZDogdHJ1ZSxcbiAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgIGNsaWVudElkOiB0b2tlbltcInN1YlwiXSxcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5jb250ZXh0LnN1Y2NlZWQoc3VjY2Vzcyk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmxvZyhcInRva2VuIHZhbGlkYXRpb24gZmFpbGVkXCIsIGVycik7XG5cbiAgICAgIGNvbnN0IGVycm9yID0gZXJyIGFzIHsgZXJyb3I6IGFueTsgdG9rZW46IFJlY29yZDxzdHJpbmcsIGFueT4gfTtcblxuICAgICAgaWYgKGVycm9yLmVycm9yID09PSBwZXJzb25hLmVycm9yVHlwZXMuSU5TVUZGSUNJRU5UX1NDT1BFKSB7XG4gICAgICAgIGNvbnN0IGluc3VmZmljaWVudFNjb3BlID0ge1xuICAgICAgICAgIGlzQXV0aG9yaXplZDogZmFsc2UsXG4gICAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgICAgZGVzY3JpcHRpb246IFwiSW5zdWZmaWNpZW50IFNjb3BlXCIsXG4gICAgICAgICAgICBjbGllbnRJZDogZXJyb3I/LnRva2VuID8gZXJyb3IudG9rZW5bXCJzdWJcIl0gOiBcIlwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuc3VjY2VlZChpbnN1ZmZpY2llbnRTY29wZSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZhaWx1cmUgPSB7XG4gICAgICAgIGlzQXV0aG9yaXplZDogZmFsc2UsXG4gICAgICAgIGNvbnRleHQ6IHtcbiAgICAgICAgICBjbGllbnRJZDogZXJyb3I/LnRva2VuID8gZXJyb3IudG9rZW5bXCJzdWJcIl0gOiBcIlwiLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIHJldHVybiB0aGlzLmNvbnRleHQuc3VjY2VlZChmYWlsdXJlKTtcbiAgICB9XG4gIH1cblxuICB2YWxpZGF0ZVRva2VuKHZhbGlkYXRpb25PcHRzOiBhbnkpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmdldFBlcnNvbmFDbGllbnQoKTtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgY2xpZW50LnZhbGlkYXRlVG9rZW4oXG4gICAgICAgIHZhbGlkYXRpb25PcHRzLFxuICAgICAgICAoZXJyb3I6IGFueSwgb2s6IGFueSwgZGVjb2RlZFRva2VuOiBhbnkpID0+IHtcbiAgICAgICAgICBpZiAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJlamVjdCh7XG4gICAgICAgICAgICAgIGVycm9yOiBlcnJvcixcbiAgICAgICAgICAgICAgdG9rZW46IGRlY29kZWRUb2tlbixcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXNvbHZlKGRlY29kZWRUb2tlbik7XG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQnJlYWsgZG93biBhbiBBUEkgZ2F0ZXdheSBtZXRob2QgQVJOIGludG8gaXQncyBjb25zdGl0dWVudCBwYXJ0cy5cbiAgICogTWV0aG9kIEFSTnMgdGFrZSB0aGUgZm9sbG93aW5nIGZvcm1hdDpcbiAgICpcbiAgICogICBhcm46YXdzOmV4ZWN1dGUtYXBpOjxSZWdpb24gaWQ+OjxBY2NvdW50IGlkPjo8QVBJIGlkPi88U3RhZ2U+LzxNZXRob2Q+LzxSZXNvdXJjZSBwYXRoPlxuICAgKlxuICAgKiBlLmc6XG4gICAqXG4gICAqICAgYXJuOmF3czpleGVjdXRlLWFwaTpldS13ZXN0LTE6MTIzOmFiYy9kZXZlbG9wbWVudC9HRVQvMi93b3Jrc1xuICAgKlxuICAgKiBAcGFyYW0gbWV0aG9kQXJuIHtzdHJpbmd9IFRoZSBtZXRob2QgQVJOIHByb3ZpZGVkIGJ5IHRoZSBldmVudCBoYW5kZWQgdG8gYSBMYW1iZGEgZnVuY3Rpb25cbiAgICogQHJldHVybnMge3tcbiAgICogICBtZXRob2Q6IHN0cmluZyxcbiAgICogICByZXNvdXJjZVBhdGg6IHN0cmluZyxcbiAgICogICBhcGlPcHRpb25zOiB7XG4gICAqICAgICByZWdpb246IHN0cmluZyxcbiAgICogICAgIHJlc3RBcGlJZDogc3RyaW5nLFxuICAgKiAgICAgc3RhZ2U6IHN0cmluZ1xuICAgKiAgIH0sXG4gICAqICAgYXdzQWNjb3VudElkOiBzdHJpbmdcbiAgICogICB9fVxuICAgKi9cbiAgcGFyc2VNZXRob2RBcm4obWV0aG9kQXJuOiBzdHJpbmcpOiBQYXJzZWRBcm4ge1xuICAgIGNvbnN0IG1ldGhvZEFyblBhcnRzID0gbWV0aG9kQXJuLnNwbGl0KFwiOlwiKTtcbiAgICBjb25zb2xlLmxvZyhgTWV0aG9kIEFSTiBQYXJ0czogJHtKU09OLnN0cmluZ2lmeShtZXRob2RBcm5QYXJ0cyl9YCk7XG4gICAgbGV0IGFwaUdhdGV3YXlBcm4gPSBtZXRob2RBcm5QYXJ0c1tBUElfR0FURVdBWV9BUk5fSU5ERVhdO1xuICAgIC8vIElmIHRoZSBzcGxpdCBjcmVhdGVkIG1vcmUgdGhhbiB0aGUgZXhwZWN0ZWQgbnVtYmVyIG9mIHBhcnRzLCB0aGVuIHRoZVxuICAgIC8vIGFwaUdhdGV3YXlBcm4gbXVzdCBoYXZlIGhhZCBvbmUgb3IgbW9yZSA6J3MgaW4gaXQuIFJlY3JlYXRlIHRoZSBhcGlHYXRld2F5IGFybi5cbiAgICBmb3IgKFxuICAgICAgbGV0IGluZGV4ID0gTUVUSE9EX0FSTl9JTkRFWEVTLmxlbmd0aDtcbiAgICAgIGluZGV4IDwgbWV0aG9kQXJuUGFydHMubGVuZ3RoO1xuICAgICAgaW5kZXggKz0gMVxuICAgICkge1xuICAgICAgYXBpR2F0ZXdheUFybiArPSBgOiR7bWV0aG9kQXJuUGFydHNbaW5kZXhdfWA7XG4gICAgfVxuXG4gICAgY29uc3QgYXBpR2F0ZXdheUFyblBhcnRzID0gYXBpR2F0ZXdheUFybi5zcGxpdChcIi9cIik7XG4gICAgY29uc29sZS5sb2coYGFwaSBnYXRld2F5IGFybiBwYXJ0czogJHtKU09OLnN0cmluZ2lmeShhcGlHYXRld2F5QXJuUGFydHMpfWApO1xuXG4gICAgLy8gSWYgdGhlIHNwbGl0IGNyZWF0ZWQgbW9yZSB0aGFuIHRoZSBleHBlY3RlZCBudW1iZXIgb2YgcGFydHMsIHRoZW4gdGhlXG4gICAgLy8gcmVzb3VyY2UgcGF0aCBtdXN0IGhhdmUgaGFkIG9uZSBvciBtb3JlIC8ncyBpbiBpdC4gUmVjcmVhdGUgdGhlIHJlc291cmNlIHBhdGguXG4gICAgbGV0IHJlc291cmNlUGF0aCA9IFwiXCI7XG4gICAgZm9yIChcbiAgICAgIGxldCBpID0gQVBJX0dBVEVXQVlfQVJOX0lOREVYRVMubGVuZ3RoIC0gMTtcbiAgICAgIGkgPCBhcGlHYXRld2F5QXJuUGFydHMubGVuZ3RoO1xuICAgICAgaSArPSAxXG4gICAgKSB7XG4gICAgICByZXNvdXJjZVBhdGggKz0gYC8ke2FwaUdhdGV3YXlBcm5QYXJ0c1tpXX1gO1xuICAgIH1cbiAgICBjb25zb2xlLmxvZyhgcmVzb3VyY2UgcGF0aDogJHtKU09OLnN0cmluZ2lmeShyZXNvdXJjZVBhdGgpfWApO1xuICAgIHJldHVybiB7XG4gICAgICBtZXRob2Q6IGFwaUdhdGV3YXlBcm5QYXJ0c1tNRVRIT0RfSU5ERVhdLFxuICAgICAgcmVzb3VyY2VQYXRoLFxuICAgICAgYXBpT3B0aW9uczoge1xuICAgICAgICByZWdpb246IG1ldGhvZEFyblBhcnRzW1JFR0lPTl9JTkRFWF0sXG4gICAgICAgIHJlc3RBcGlJZDogYXBpR2F0ZXdheUFyblBhcnRzW0FQSV9JRF9JTkRFWF0sXG4gICAgICAgIHN0YWdlOiBhcGlHYXRld2F5QXJuUGFydHNbU1RBR0VfSU5ERVhdLFxuICAgICAgfSxcbiAgICAgIGF3c0FjY291bnRJZDogbWV0aG9kQXJuUGFydHNbQUNDT1VOVF9JRF9JTkRFWF0sXG4gICAgfTtcbiAgfVxuXG4gIGdldFNjb3BlKHBhcnNlZE1ldGhvZEFybjogUGFyc2VkQXJuKSB7XG4gICAgY29uc3Qgc2NvcGVDb25maWcgPSBwcm9jZXNzLmVudltcIlNDT1BFX0NPTkZJR1wiXTtcbiAgICBpZiAoc2NvcGVDb25maWcgIT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBjb25mID0gSlNPTi5wYXJzZShzY29wZUNvbmZpZyk7XG4gICAgICBmb3IgKGNvbnN0IHBhdGggb2YgT2JqZWN0LmtleXMoY29uZikpIHtcbiAgICAgICAgaWYgKHRoaXMucGF0aE1hdGNoKHBhdGgsIHBhcnNlZE1ldGhvZEFybi5yZXNvdXJjZVBhdGgpKSB7XG4gICAgICAgICAgcmV0dXJuIGNvbmZbcGF0aF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBnZXRQZXJzb25hQ2xpZW50KCkge1xuICAgIGlmICh0aGlzLnBlcnNvbmFDbGllbnQgPT0gbnVsbCkge1xuICAgICAgY29uc3QgcGVyc29uYUNvbmZpZyA9IHtcbiAgICAgICAgcGVyc29uYV9ob3N0OiBwcm9jZXNzLmVudltcIlBFUlNPTkFfSE9TVFwiXSxcbiAgICAgICAgcGVyc29uYV9zY2hlbWU6IHByb2Nlc3MuZW52W1wiUEVSU09OQV9TQ0hFTUVcIl0sXG4gICAgICAgIHBlcnNvbmFfcG9ydDogcHJvY2Vzcy5lbnZbXCJQRVJTT05BX1BPUlRcIl0sXG4gICAgICAgIHBlcnNvbmFfb2F1dGhfcm91dGU6IHByb2Nlc3MuZW52W1wiUEVSU09OQV9PQVVUSF9ST1VURVwiXSxcbiAgICAgIH07XG5cbiAgICAgIHRoaXMucGVyc29uYUNsaWVudCA9IHBlcnNvbmEuY3JlYXRlQ2xpZW50KFxuICAgICAgICBgJHtwcm9jZXNzLmVudltcIlBFUlNPTkFfQ0xJRU5UX05BTUVcIl19IChsYW1iZGE7IE5PREVfRU5WPSR7cHJvY2Vzcy5lbnZbXCJOT0RFX0VOVlwiXX0pYCxcbiAgICAgICAgXy5tZXJnZShwZXJzb25hQ29uZmlnLCB7fSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMucGVyc29uYUNsaWVudDtcbiAgfVxuXG4gIHBhdGhNYXRjaChwYXRoRGVmaW5hdGlvbjogc3RyaW5nLCBwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBwYXRoRGVmaW5hdGlvblBhcnRzID0gcGF0aERlZmluYXRpb24uc3BsaXQoXCIvXCIpO1xuICAgIGNvbnN0IHBhdGhQYXJ0cyA9IHBhdGhEZWZpbmF0aW9uLnNwbGl0KFwiL1wiKTtcblxuICAgIGlmIChwYXRoRGVmaW5hdGlvblBhcnRzLmxlbmd0aCAhPSBwYXRoUGFydHMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYXRoRGVmaW5hdGlvblBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwYXRoRGVmaW5pdGlvblNlZ21lbnQgPSBwYXRoRGVmaW5hdGlvblBhcnRzW2ldO1xuICAgICAgY29uc3QgcGF0aFNlZ21lbnQgPSBwYXRoUGFydHNbaV07XG5cbiAgICAgIGlmIChwYXRoRGVmaW5hdGlvbi5zdGFydHNXaXRoKFwie1wiKSAmJiBwYXRoRGVmaW5hdGlvbi5lbmRzV2l0aChcIn1cIikpIHtcbiAgICAgICAgLy8gTWF0Y2hlcyBwYXRoIGFyZ3VtZW50XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTaG91bGQgbWF0Y2ggZGlyZWN0bHlcbiAgICAgICAgaWYgKHBhdGhEZWZpbml0aW9uU2VnbWVudCAhPT0gcGF0aFNlZ21lbnQpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cy52YWxpZGF0ZVRva2VuID0gYXN5bmMgKGV2ZW50OiBhbnksIGNvbnRleHQ6IGFueSkgPT4ge1xuICBjb25zdCByb3V0ZSA9IG5ldyBQZXJzb25hQXV0aG9yaXplcihldmVudCwgY29udGV4dCk7XG4gIHJldHVybiBhd2FpdCByb3V0ZS5oYW5kbGUoKTtcbn07XG4iXX0=