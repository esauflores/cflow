/**
 * What the web app needs to call the API, so it doesn't depend on Hono itself: Hono's typed client and the API's
 * type. Only the client ships to the browser; AppType is a type, so none of the API's code does.
 */
export { DetailedError, hc, parseResponse, type ClientResponse } from "hono/client";
export type { AppType } from "./app.ts";
