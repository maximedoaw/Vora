/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as chat from "../chat.js";
import type * as drivers from "../drivers.js";
import type * as http from "../http.js";
import type * as model_auth from "../model/auth.js";
import type * as model_companions from "../model/companions.js";
import type * as model_geo from "../model/geo.js";
import type * as model_phone from "../model/phone.js";
import type * as push from "../push.js";
import type * as rides from "../rides.js";
import type * as routing from "../routing.js";
import type * as sharing from "../sharing.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  chat: typeof chat;
  drivers: typeof drivers;
  http: typeof http;
  "model/auth": typeof model_auth;
  "model/companions": typeof model_companions;
  "model/geo": typeof model_geo;
  "model/phone": typeof model_phone;
  push: typeof push;
  rides: typeof rides;
  routing: typeof routing;
  sharing: typeof sharing;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
