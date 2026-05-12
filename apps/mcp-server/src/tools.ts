import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ConvexApiError, ConvexMcpClient } from './client.js';

/**
 * Register every Arch Viz MCP tool on the given server. Each tool wraps a
 * single Convex HTTP route from `convex/http.ts`.
 *
 * Input schemas here are intentionally lightweight — Convex re-validates
 * everything strictly via Zod. This shape only exists to give the MCP
 * client a hint about each tool's signature.
 */
export function registerTools(server: McpServer, client: ConvexMcpClient) {
  registerListNodes(server, client);
  registerGetNode(server, client);
  registerCreateNode(server, client);
  registerUpdateNode(server, client);
  registerDeleteNode(server, client);
  registerLinkFiles(server, client);
  registerAddKanbanTask(server, client);
  registerUpdateKanbanStatus(server, client);
  registerLogActivity(server, client);
  registerLinkNodes(server, client);
  registerUnlinkNodes(server, client);
  registerLookupFiles(server, client);
}

/* ----------------------------- helpers ----------------------------------- */

type CallResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(body: unknown): CallResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}

function errResult(err: unknown): CallResult {
  let text: string;
  if (err instanceof ConvexApiError) text = err.toToolError();
  else if (err instanceof Error) text = err.message;
  else text = String(err);
  return { content: [{ type: 'text', text }], isError: true };
}

async function run<T>(fn: () => Promise<T>): Promise<CallResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return errResult(err);
  }
}

/* ---------------------------- tool: list_nodes --------------------------- */

function registerListNodes(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'list_nodes',
    {
      description:
        'List every node in the project this MCP instance is scoped to. Returns id, type, name, parentId, description, positionX, positionY for each node. Call this first when starting work to understand the current canvas state.',
      inputSchema: {},
    },
    async () => run(() => client.post('/api/mcp/nodes/list', {})),
  );
}

/* ----------------------------- tool: get_node ---------------------------- */

function registerGetNode(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'get_node',
    {
      description:
        'Fetch one node by id, with its linked files and kanban tasks joined.',
      inputSchema: { nodeId: z.string().describe('Id of the node to fetch.') },
    },
    async ({ nodeId }) => run(() => client.post('/api/mcp/nodes/get', { nodeId })),
  );
}

/* --------------------------- tool: create_node --------------------------- */

function registerCreateNode(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'create_node',
    {
      description:
        'Create a new page or feature node in the canvas. Use `parentId` to nest a feature under an existing page. Position is optional — server scatters around origin if omitted. Optional `files` attaches file paths in one call.',
      inputSchema: {
        type: z.enum(['page', 'feature']).describe('"page" for a top-level page; "feature" for a nested sub-feature under a page.'),
        name: z.string().describe('Human-readable name shown on the canvas.'),
        parentId: z.string().optional().describe('Required when type is "feature".'),
        description: z.string().optional(),
        files: z.array(z.string()).optional().describe('File paths to link to the new node in one call.'),
        positionX: z.number().optional(),
        positionY: z.number().optional(),
      },
    },
    async (args) => run(() => client.post('/api/mcp/nodes/create', args)),
  );
}

/* --------------------------- tool: update_node --------------------------- */

function registerUpdateNode(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'update_node',
    {
      description:
        'Partially update a node. At least one field must be provided. `metadata` is a free-form JSON object; set `metadata.route` (e.g. "/dashboard") so navigation arrows can target this node, and `metadata.apiPaths` (e.g. ["api.auth.login"]) so data-flow arrows resolve to it.',
      inputSchema: {
        nodeId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        positionX: z.number().optional(),
        positionY: z.number().optional(),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe('Free-form JSON. Merged over existing metadata, not replaced.'),
      },
    },
    async (args) => run(() => client.post('/api/mcp/nodes/update', args)),
  );
}

/* --------------------------- tool: delete_node --------------------------- */

function registerDeleteNode(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'delete_node',
    {
      description:
        'Delete a node and cascade-delete its children, linked files, kanban tasks, and activity log entries. Idempotent.',
      inputSchema: { nodeId: z.string() },
    },
    async ({ nodeId }) => run(() => client.post('/api/mcp/nodes/delete', { nodeId })),
  );
}

/* --------------------------- tool: link_files ---------------------------- */

function registerLinkFiles(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'link_files',
    {
      description:
        'Attach one or more file paths to a node. Duplicates within the call and against existing links are ignored. Returns the number of paths actually linked.',
      inputSchema: {
        nodeId: z.string(),
        paths: z.array(z.string()).describe('Repo-relative file paths.'),
      },
    },
    async (args) => run(() => client.post('/api/mcp/files/link', args)),
  );
}

/* ------------------------ tool: add_kanban_task -------------------------- */

function registerAddKanbanTask(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'add_kanban_task',
    {
      description:
        'Add a kanban task to a node. Use status "todo" for planned work, "doing" when starting, "done" once shipped.',
      inputSchema: {
        nodeId: z.string(),
        title: z.string(),
        description: z.string().optional(),
        status: z.enum(['todo', 'doing', 'done']).default('todo'),
      },
    },
    async (args) => run(() => client.post('/api/mcp/kanban/add', args)),
  );
}

/* ---------------------- tool: update_kanban_status ----------------------- */

function registerUpdateKanbanStatus(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'update_kanban_status',
    {
      description:
        'Move a kanban task across columns: todo → doing → done. Repositions to the bottom of the destination column.',
      inputSchema: {
        taskId: z.string(),
        status: z.enum(['todo', 'doing', 'done']),
      },
    },
    async (args) => run(() => client.post('/api/mcp/kanban/status', args)),
  );
}

/* --------------------------- tool: log_activity -------------------------- */

function registerLogActivity(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'log_activity',
    {
      description:
        'Append an activity log entry to a node. Use this after meaningful work on a node (commit, fix, feature shipped). `actor` should identify the agent, e.g. "mcp:claude-code".',
      inputSchema: {
        nodeId: z.string(),
        actor: z.string(),
        message: z.string(),
        metadata: z.record(z.unknown()).optional(),
      },
    },
    async (args) => run(() => client.post('/api/mcp/activity/log', args)),
  );
}

/* --------------------------- tool: link_nodes ---------------------------- */

function registerLinkNodes(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'link_nodes',
    {
      description:
        'Manually classify a directed edge between two nodes (dependency / navigation / data_flow). Use this when you know two nodes are related but the import scanner cannot see it — e.g. cross-language calls, cross-process messaging, or runtime-resolved dynamic dispatch. The edge is marked `manual` and is preserved across scan-imports reconciliations.',
      inputSchema: {
        sourceNodeId: z.string(),
        targetNodeId: z.string(),
        type: z
          .enum(['dependency', 'navigation', 'data_flow'])
          .describe(
            'dependency = X uses Y; navigation = X links/routes to Y; data_flow = X sends data to Y.',
          ),
      },
    },
    async (args) => run(() => client.post('/api/mcp/edges/link', args)),
  );
}

/* -------------------------- tool: unlink_nodes --------------------------- */

function registerUnlinkNodes(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'unlink_nodes',
    {
      description:
        'Remove a previously-classified edge (any source) between two nodes. Hierarchy edges cannot be unlinked through this tool; they follow `parentId`. Idempotent — removing a nonexistent edge is fine.',
      inputSchema: {
        sourceNodeId: z.string(),
        targetNodeId: z.string(),
        type: z.enum(['dependency', 'navigation', 'data_flow']),
      },
    },
    async (args) => run(() => client.post('/api/mcp/edges/unlink', args)),
  );
}

/* -------------------------- tool: lookup_files --------------------------- */

function registerLookupFiles(server: McpServer, client: ConvexMcpClient) {
  server.registerTool(
    'lookup_files',
    {
      description:
        'Bulk-classify a list of repo-relative file paths against the project. Returns `linked` (paths already tracked by some node) and `unlinked` (candidates for a new node). Use before proposing /arch-suggest-nodes follow-ups so you do not re-create existing tracking.',
      inputSchema: {
        paths: z
          .array(z.string())
          .describe('Repo-relative POSIX paths (e.g. "src/foo/bar.ts"). Cap 500 per call.'),
      },
    },
    async (args) => run(() => client.post('/api/mcp/files/lookup', args)),
  );
}
