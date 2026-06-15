import { ConvexMcpClient } from '../client.js';
import { ConfigError, type McpConfig } from '../config.js';
import { progress } from './output.js';

export interface ProjectScopeHealth {
  projectId: string;
  projectName: string;
  tokenName?: string;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

export function assertProjectScope(config: McpConfig, health: ProjectScopeHealth) {
  if (health.projectId !== config.projectId) {
    throw new ConfigError(
      `ARCHITECTURE_PROJECT_ID is ${config.projectId}, but the API token is scoped to ${health.projectId} (${health.projectName}). Use a token and project id from the same canvas before running a scan.`,
    );
  }

  if (config.expectedProjectId && health.projectId !== config.expectedProjectId) {
    throw new ConfigError(
      `Refusing to scan project ${health.projectId} (${health.projectName}); expected project id ${config.expectedProjectId}.`,
    );
  }

  if (
    config.expectedProjectName &&
    normalizeName(health.projectName) !== normalizeName(config.expectedProjectName)
  ) {
    throw new ConfigError(
      `Refusing to scan project "${health.projectName}"; expected project name "${config.expectedProjectName}".`,
    );
  }
}

export async function verifyProjectScope(
  client: ConvexMcpClient,
  config: McpConfig,
  commandName: string,
) {
  const health = await client.post<ProjectScopeHealth>('/api/mcp/health', {});
  assertProjectScope(config, health);
  progress(
    `[${commandName}] target=${health.projectName} (${health.projectId}) token=${health.tokenName ?? '(unknown)'}`,
  );
  return health;
}
