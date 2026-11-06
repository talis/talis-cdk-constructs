import { PersonaAuthorizer } from "./PersonaAuthorizer";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const validateToken = async (event: any, context: any) => {
  const route = new PersonaAuthorizer(event, context);
  return await route.handle();
};
/* eslint-enable @typescript-eslint/no-explicit-any */
