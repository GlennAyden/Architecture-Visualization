export type HermesSuggestionAction =
  | 'create_node'
  | 'link_existing_node'
  | 'group_into_node'
  | 'ignore';

export interface HermesLayerContext {
  _id: string;
  name: string;
  position: number;
}

export interface HermesNodeContext {
  _id: string;
  name: string;
  type: string;
  layerId?: string;
  parentId?: string;
  files: string[];
}

export interface HermesFileFact {
  path: string;
  kind?: string;
  imports?: string[];
  exports?: string[];
  routeHint?: string;
  apiHint?: string;
}

export interface HermesExistingSuggestion {
  filePath: string;
  action: HermesSuggestionAction;
  status: 'pending' | 'applied' | 'rejected' | 'ignored';
  layerId?: string;
  targetNodeId?: string;
  groupKey?: string;
  confidence: number;
}

export interface HermesMappingContext {
  runId: string;
  project: { _id: string; name: string };
  layers: HermesLayerContext[];
  nodes: HermesNodeContext[];
  latestScan: { data?: unknown } | null;
  suggestions: HermesExistingSuggestion[];
}

export interface HermesMappingSuggestion {
  filePath: string;
  action: HermesSuggestionAction;
  layerId?: string;
  targetNodeId?: string;
  groupKey?: string;
  suggestedNodeName?: string;
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

export interface HermesMappingResult {
  suggestions: HermesMappingSuggestion[];
}

export type HermesMapper = (context: HermesMappingContext) => Promise<HermesMappingResult>;

function scanData(context: HermesMappingContext) {
  const data = context.latestScan?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function normalized(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function fileName(path: string) {
  return normalized(path).split('/').at(-1) ?? path;
}

function directory(path: string) {
  const parts = normalized(path).split('/');
  parts.pop();
  return parts.join('/');
}

function titleFromPath(path: string) {
  const base = fileName(path).replace(/\.[^.]+$/, '');
  const words = base
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[-_.]+/g, ' ')
    .trim();
  if (words && words !== 'route' && words !== 'page' && words !== 'index') return toTitle(words);

  const dir = directory(path).split('/').at(-1) ?? base;
  return toTitle(dir.replace(/[-_.]+/g, ' '));
}

function toTitle(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function layerByName(layers: HermesLayerContext[], names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  return (
    layers.find((layer) => normalizedNames.includes(layer.name.toLowerCase())) ??
    layers.find((layer) =>
      normalizedNames.some((name) => layer.name.toLowerCase().includes(name)),
    ) ??
    layers[0]
  );
}

function layerForFact(layers: HermesLayerContext[], path: string, fact?: HermesFileFact) {
  const lower = normalized(path).toLowerCase();
  const kind = fact?.kind;
  if (kind === 'convex' || lower.startsWith('convex/')) return layerByName(layers, ['Convex']);
  if (kind === 'mcp' || lower.startsWith('apps/mcp-server/')) {
    return layerByName(layers, ['MCP / Agents', 'Agents']);
  }
  if (kind === 'api' || lower.startsWith('apps/web/app/api/')) {
    return layerByName(layers, ['Surfaces', 'Infra']);
  }
  if (lower.startsWith('apps/vps-api/') || kind === 'script' || kind === 'config') {
    return layerByName(layers, ['Infra', 'External']);
  }
  if (kind === 'component' || lower.startsWith('apps/web/')) {
    return layerByName(layers, ['Surfaces']);
  }
  return layerByName(layers, ['Features', 'Surfaces']);
}

function evidenceFor(path: string, fact?: HermesFileFact) {
  const evidence = new Set<string>();
  if (fact?.kind) evidence.add(`${fact.kind} file`);
  if (fact?.routeHint) evidence.add(`route ${fact.routeHint}`);
  if (fact?.apiHint) evidence.add(`api ${fact.apiHint}`);
  for (const exported of fact?.exports?.slice(0, 2) ?? []) evidence.add(`exports ${exported}`);
  for (const imported of fact?.imports?.slice(0, 2) ?? []) evidence.add(`imports ${imported}`);
  if (evidence.size === 0) evidence.add(`path ${normalized(path)}`);
  return [...evidence].slice(0, 8);
}

function nodeMatchScore(path: string, node: HermesNodeContext) {
  const lowerPath = normalized(path).toLowerCase();
  const pathParts = lowerPath.split('/');
  const nodeName = node.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let score = 0;

  if (nodeName && lowerPath.includes(nodeName.replace(/\s+/g, '-'))) score += 2;
  if (nodeName && lowerPath.includes(nodeName.replace(/\s+/g, '/'))) score += 2;

  for (const file of node.files) {
    const linked = normalized(file).toLowerCase();
    const linkedDir = directory(linked);
    if (linkedDir && lowerPath.startsWith(`${linkedDir}/`)) score += 3;
    const linkedParts = linked.split('/');
    const sharedPrefix = linkedParts.findIndex((part, index) => part !== pathParts[index]);
    if (sharedPrefix >= 3) score += 2;
  }

  return score;
}

function bestNodeForPath(path: string, nodes: HermesNodeContext[]) {
  let best: { node: HermesNodeContext; score: number } | null = null;
  for (const node of nodes) {
    const score = nodeMatchScore(path, node);
    if (!best || score > best.score) best = { node, score };
  }
  return best && best.score >= 3 ? best.node : null;
}

function extractScanFiles(context: HermesMappingContext) {
  const data = scanData(context);
  const orphans = Array.isArray(data.orphans)
    ? data.orphans.filter((v) => typeof v === 'string')
    : [];
  const fileFacts = Array.isArray(data.fileFacts)
    ? data.fileFacts.filter((fact): fact is HermesFileFact => {
        return Boolean(fact && typeof fact === 'object' && typeof fact.path === 'string');
      })
    : [];
  const factByPath = new Map(fileFacts.map((fact) => [normalized(fact.path), fact]));
  return { orphans: orphans.map(normalized).slice(0, 500), factByPath };
}

function folderGroupKey(path: string, fact?: HermesFileFact) {
  const dir = directory(path);
  if (!dir) return null;
  if (fact?.kind === 'generated' || fact?.kind === 'test' || fact?.kind === 'config') return null;
  if (dir.startsWith('apps/web/app/api/')) return dir.replace(/^apps\/web\/app\/api\//, 'api:');
  if (dir.startsWith('apps/web/lib/')) return dir.replace(/^apps\/web\/lib\//, 'web-lib:');
  if (dir.startsWith('apps/vps-api/src/')) return dir.replace(/^apps\/vps-api\/src\//, 'vps:');
  if (dir.startsWith('convex/')) return dir.replace(/^convex\//, 'convex:');
  return null;
}

export async function heuristicHermesMapper(
  context: HermesMappingContext,
): Promise<HermesMappingResult> {
  const { orphans, factByPath } = extractScanFiles(context);
  const existingByPath = new Map(
    context.suggestions.map((suggestion) => [normalized(suggestion.filePath), suggestion.status]),
  );
  const groupCounts = new Map<string, number>();
  for (const path of orphans) {
    const key = folderGroupKey(path, factByPath.get(path));
    if (key) groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }

  const suggestions: HermesMappingSuggestion[] = [];
  for (const path of orphans) {
    const existingStatus = existingByPath.get(path);
    if (existingStatus === 'applied' || existingStatus === 'ignored') continue;

    const fact = factByPath.get(path);
    const kind = fact?.kind;
    const layer = layerForFact(context.layers, path, fact);
    const evidence = evidenceFor(path, fact);

    if (kind === 'generated' || kind === 'test') {
      suggestions.push({
        filePath: path,
        action: 'ignore',
        confidence: kind === 'generated' ? 0.96 : 0.91,
        reason:
          kind === 'generated'
            ? 'Generated files are derived output and should not become architecture nodes.'
            : 'Test-only files support verification and usually do not represent runtime architecture.',
        evidence,
        source: 'hermes',
      });
      continue;
    }

    const existingNode = bestNodeForPath(path, context.nodes);
    if (existingNode) {
      suggestions.push({
        filePath: path,
        action: 'link_existing_node',
        targetNodeId: existingNode._id,
        suggestedNodeName: existingNode.name,
        confidence: 0.91,
        reason: `This file sits beside files already owned by "${existingNode.name}".`,
        evidence,
        source: 'hermes',
      });
      continue;
    }

    if (kind === 'config' && !/package\.json$|next\.config|convex\/auth\.config/.test(path)) {
      suggestions.push({
        filePath: path,
        action: 'ignore',
        confidence: 0.9,
        reason: 'Tooling config is useful context but usually not a standalone architecture node.',
        evidence,
        source: 'hermes',
      });
      continue;
    }

    const groupKey = folderGroupKey(path, fact);
    if (groupKey && (groupCounts.get(groupKey) ?? 0) > 1) {
      suggestions.push({
        filePath: path,
        action: 'group_into_node',
        layerId: layer?._id,
        groupKey,
        suggestedNodeName: titleFromPath(directory(path)),
        confidence: 0.86,
        reason: 'Several related files share this folder and should be reviewed as one node.',
        evidence,
        source: 'hermes',
      });
      continue;
    }

    suggestions.push({
      filePath: path,
      action: 'create_node',
      layerId: layer?._id,
      suggestedNodeName: titleFromPath(path),
      confidence: kind === 'api' || kind === 'convex' || kind === 'mcp' ? 0.86 : 0.78,
      reason:
        'The file appears to represent a distinct architecture surface or implementation unit.',
      evidence,
      source: 'hermes',
    });
  }

  return { suggestions };
}
