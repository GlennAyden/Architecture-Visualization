/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as apiTokens from "../apiTokens.js";
import type * as codebaseSuggestions from "../codebaseSuggestions.js";
import type * as crons from "../crons.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as kanban from "../kanban.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cascade from "../lib/cascade.js";
import type * as lib_codebaseSuggestions from "../lib/codebaseSuggestions.js";
import type * as lib_edges from "../lib/edges.js";
import type * as lib_layers from "../lib/layers.js";
import type * as lib_mcpAuth from "../lib/mcpAuth.js";
import type * as lib_mcpRoute from "../lib/mcpRoute.js";
import type * as lib_tokens from "../lib/tokens.js";
import type * as mcp_activity from "../mcp/activity.js";
import type * as mcp_codebaseSuggestions from "../mcp/codebaseSuggestions.js";
import type * as mcp_edges from "../mcp/edges.js";
import type * as mcp_files from "../mcp/files.js";
import type * as mcp_kanban from "../mcp/kanban.js";
import type * as mcp_layers from "../mcp/layers.js";
import type * as mcp_lib from "../mcp/lib.js";
import type * as mcp_nodes from "../mcp/nodes.js";
import type * as mcp_scans from "../mcp/scans.js";
import type * as nodeEdges from "../nodeEdges.js";
import type * as nodeFiles from "../nodeFiles.js";
import type * as nodes from "../nodes.js";
import type * as profiles from "../profiles.js";
import type * as projectLayers from "../projectLayers.js";
import type * as projectMembers from "../projectMembers.js";
import type * as projects from "../projects.js";
import type * as scans from "../scans.js";
import type * as shareTokens from "../shareTokens.js";
import type * as shareView from "../shareView.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  apiTokens: typeof apiTokens;
  codebaseSuggestions: typeof codebaseSuggestions;
  crons: typeof crons;
  exports: typeof exports;
  http: typeof http;
  kanban: typeof kanban;
  "lib/auth": typeof lib_auth;
  "lib/cascade": typeof lib_cascade;
  "lib/codebaseSuggestions": typeof lib_codebaseSuggestions;
  "lib/edges": typeof lib_edges;
  "lib/layers": typeof lib_layers;
  "lib/mcpAuth": typeof lib_mcpAuth;
  "lib/mcpRoute": typeof lib_mcpRoute;
  "lib/tokens": typeof lib_tokens;
  "mcp/activity": typeof mcp_activity;
  "mcp/codebaseSuggestions": typeof mcp_codebaseSuggestions;
  "mcp/edges": typeof mcp_edges;
  "mcp/files": typeof mcp_files;
  "mcp/kanban": typeof mcp_kanban;
  "mcp/layers": typeof mcp_layers;
  "mcp/lib": typeof mcp_lib;
  "mcp/nodes": typeof mcp_nodes;
  "mcp/scans": typeof mcp_scans;
  nodeEdges: typeof nodeEdges;
  nodeFiles: typeof nodeFiles;
  nodes: typeof nodes;
  profiles: typeof profiles;
  projectLayers: typeof projectLayers;
  projectMembers: typeof projectMembers;
  projects: typeof projects;
  scans: typeof scans;
  shareTokens: typeof shareTokens;
  shareView: typeof shareView;
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
