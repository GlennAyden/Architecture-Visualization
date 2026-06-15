export type HermesSuggestionAction =
  | 'create_node'
  | 'link_existing_node'
  | 'group_into_node'
  | 'ignore';

export interface HermesLayerContext {
  _id: string;
  name: string;
  position: number;
  purpose?: string;
  description?: string;
}

export interface HermesLinkedFileContext {
  path: string;
  role?: string;
  source?: string;
  confidence?: number;
  reason?: string;
  evidence?: string[];
  verifiedAt?: number;
}

export interface HermesNodeContext {
  _id: string;
  name: string;
  type: string;
  layerId?: string;
  parentId?: string;
  semanticKind?: string;
  mappingStatus?: string;
  mappingConfidence?: number;
  files: string[];
  linkedFiles?: HermesLinkedFileContext[];
}

export interface HermesEdgeContext {
  _id?: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: HermesRelationshipSuggestionType;
  source?: string;
  label?: string;
  confidence?: number;
  reason?: string;
  evidence?: string[];
}

export interface HermesFileFact {
  path: string;
  kind?: string;
  imports?: string[];
  resolvedImports?: string[];
  exports?: string[];
  routeHint?: string;
  apiHint?: string;
  featureHint?: string;
  pathGroup?: string;
  testTargetHint?: string;
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

export type HermesRelationshipSuggestionType = 'dependency' | 'navigation' | 'data_flow';

export interface HermesExistingRelationshipSuggestion {
  sourceNodeId: string;
  targetNodeId: string;
  type: HermesRelationshipSuggestionType;
  label?: string;
  status: 'pending' | 'applied' | 'rejected' | 'ignored';
  confidence: number;
}

export type HermesArchitectureFlowKind =
  | 'user_journey'
  | 'system_process'
  | 'data_flow'
  | 'agent_workflow'
  | 'build_deploy'
  | 'integration';

export interface HermesExistingArchitectureFlow {
  title: string;
  curationKey?: string;
  kind: HermesArchitectureFlowKind;
  status: 'pending' | 'applied' | 'rejected' | 'ignored';
  nodeIds: string[];
  confidence: number;
}

export interface HermesMappingContext {
  runId: string;
  project: { _id: string; name: string };
  layers: HermesLayerContext[];
  nodes: HermesNodeContext[];
  edges?: HermesEdgeContext[];
  latestScan: { data?: unknown } | null;
  suggestions: HermesExistingSuggestion[];
  relationshipSuggestions?: HermesExistingRelationshipSuggestion[];
  flows?: HermesExistingArchitectureFlow[];
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
  semanticKind?: string;
  fileRole?: string;
  source: string;
}

export interface HermesRelationshipSuggestion {
  sourceNodeId: string;
  targetNodeId: string;
  type: HermesRelationshipSuggestionType;
  label?: string;
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

export interface HermesFlowEdgeRef {
  edgeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  type?: HermesRelationshipSuggestionType;
}

export interface HermesFlowStep {
  title: string;
  description: string;
  nodeIds?: string[];
  edgeRefs?: HermesFlowEdgeRef[];
}

export interface HermesArchitectureFlowSuggestion {
  title: string;
  shortTitle?: string;
  goal?: string;
  importance?: number;
  curationKey?: string;
  description: string;
  kind: HermesArchitectureFlowKind;
  nodeIds: string[];
  edgeRefs?: HermesFlowEdgeRef[];
  steps: HermesFlowStep[];
  confidence: number;
  reason: string;
  evidence?: string[];
  source: string;
}

export interface HermesMappingResult {
  suggestions: HermesMappingSuggestion[];
  relationshipSuggestions?: HermesRelationshipSuggestion[];
  flowSuggestions?: HermesArchitectureFlowSuggestion[];
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
  if (kind === 'convex' || lower.startsWith('convex/')) {
    if (lower.includes('schema') || lower.includes('snapshot')) {
      return layerByName(layers, ['Data', 'Backend', 'Convex']);
    }
    return layerByName(layers, ['Backend', 'Data', 'Convex']);
  }
  if (kind === 'mcp' || lower.startsWith('apps/mcp-server/')) {
    return layerByName(layers, ['Agents', 'MCP / Agents']);
  }
  if (kind === 'api' || lower.startsWith('apps/web/app/api/')) {
    return layerByName(layers, ['Backend', 'Application', 'Surfaces']);
  }
  if (lower.startsWith('apps/vps-api/')) {
    return layerByName(layers, ['Backend', 'Infra']);
  }
  if (kind === 'script' || kind === 'config') {
    return layerByName(layers, ['Infra', 'Application']);
  }
  if (kind === 'component' || lower.startsWith('apps/web/')) {
    return layerByName(layers, ['Surfaces']);
  }
  return layerByName(layers, ['Application', 'Features', 'Surfaces']);
}

function semanticKindForFact(path: string, fact?: HermesFileFact) {
  const lower = normalized(path).toLowerCase();
  const kind = fact?.kind;
  if (kind === 'component') return 'surface';
  if (kind === 'api' || lower.includes('/api/')) return 'api';
  if (kind === 'convex') return lower.includes('schema') ? 'storage' : 'data_logic';
  if (kind === 'mcp') return 'agent';
  if (lower.startsWith('apps/vps-api/')) return 'worker';
  if (kind === 'config' || kind === 'script') return 'config';
  if (kind === 'test') return 'test_harness';
  if (kind === 'generated') return 'unknown';
  return 'capability';
}

function fileRoleForFact(path: string, fact?: HermesFileFact) {
  const lower = normalized(path).toLowerCase();
  const kind = fact?.kind;
  if (kind === 'test') return 'test';
  if (kind === 'config' || kind === 'script') return 'config';
  if (kind === 'component') return 'ui';
  if (kind === 'api') return lower.endsWith('/route.ts') ? 'route' : 'api';
  if (kind === 'convex') {
    if (lower.includes('schema')) return 'schema';
    if (lower.includes('query') || lower.endsWith('queries.ts')) return 'query';
    if (lower.includes('mutation')) return 'mutation';
    return 'support';
  }
  if (kind === 'mcp' || lower.startsWith('apps/vps-api/')) return 'worker';
  return 'primary';
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

  for (const file of linkedPaths(node)) {
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

function linkedPaths(node: HermesNodeContext) {
  const fromLinkedFiles = node.linkedFiles
    ?.map((file) => file.path)
    .filter((path): path is string => typeof path === 'string' && path.trim().length > 0);
  return fromLinkedFiles && fromLinkedFiles.length > 0 ? fromLinkedFiles : node.files;
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

function existingRelationshipKey(
  sourceNodeId: string,
  targetNodeId: string,
  type: HermesRelationshipSuggestionType,
) {
  return `${sourceNodeId}|${targetNodeId}|${type}`;
}

function buildNodeByFile(nodes: HermesNodeContext[]) {
  const nodeByFile = new Map<string, HermesNodeContext>();
  for (const node of nodes) {
    for (const path of linkedPaths(node)) {
      nodeByFile.set(normalized(path), node);
    }
  }
  return nodeByFile;
}

function buildRelationshipKeys(context: HermesMappingContext) {
  const keys = new Set<string>();
  for (const edge of context.edges ?? []) {
    keys.add(existingRelationshipKey(edge.sourceNodeId, edge.targetNodeId, edge.type));
  }
  for (const suggestion of context.relationshipSuggestions ?? []) {
    if (suggestion.status === 'applied' || suggestion.status === 'ignored') {
      keys.add(
        existingRelationshipKey(suggestion.sourceNodeId, suggestion.targetNodeId, suggestion.type),
      );
    }
  }
  return keys;
}

function relationshipSuggestionsFromImports(
  context: HermesMappingContext,
  factByPath: Map<string, HermesFileFact>,
) {
  const nodeByFile = buildNodeByFile(context.nodes);
  const existingKeys = buildRelationshipKeys(context);
  const suggestions: HermesRelationshipSuggestion[] = [];
  const sortedFacts = [...factByPath.values()].sort((a, b) =>
    normalized(a.path).localeCompare(normalized(b.path)),
  );

  for (const fact of sortedFacts) {
    const sourceNode = nodeByFile.get(normalized(fact.path));
    if (!sourceNode) continue;
    for (const imported of fact.resolvedImports ?? fact.imports ?? []) {
      const targetNode = nodeByFile.get(normalized(imported));
      if (!targetNode || targetNode._id === sourceNode._id) continue;
      const key = existingRelationshipKey(sourceNode._id, targetNode._id, 'dependency');
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      suggestions.push({
        sourceNodeId: sourceNode._id,
        targetNodeId: targetNode._id,
        type: 'dependency',
        label: 'imports',
        confidence: 0.91,
        reason: `"${sourceNode.name}" imports a file owned by "${targetNode.name}".`,
        evidence: [`${normalized(fact.path)} imports ${normalized(imported)}`],
        source: 'hermes',
      });
      if (suggestions.length >= 100) return suggestions;
    }
  }

  return suggestions;
}

type FlowEdgeCandidate = {
  edgeId?: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: HermesRelationshipSuggestionType;
  label?: string;
  confidence?: number;
  source?: string;
  evidence?: string[];
};

function nodeLayerName(context: HermesMappingContext, node: HermesNodeContext) {
  const layer = context.layers.find((candidate) => candidate._id === node.layerId);
  return layer?.name.toLowerCase() ?? '';
}

function nodeMatches(node: HermesNodeContext, context: HermesMappingContext, terms: string[]) {
  const haystack =
    `${node.name} ${node.semanticKind ?? ''} ${nodeLayerName(context, node)}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function buildFlowEdges(
  context: HermesMappingContext,
  relationshipSuggestions: HermesRelationshipSuggestion[],
): FlowEdgeCandidate[] {
  return [
    ...(context.edges ?? []).map(
      (edge): FlowEdgeCandidate => ({
        edgeId: edge._id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
        label: edge.label,
        confidence: edge.confidence,
        source: edge.source,
        evidence: edge.evidence,
      }),
    ),
    ...relationshipSuggestions.map(
      (edge): FlowEdgeCandidate => ({
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
        label: edge.label,
        confidence: edge.confidence,
        source: edge.source,
        evidence: edge.evidence,
      }),
    ),
  ].filter((edge) => edge.sourceNodeId !== edge.targetNodeId);
}

type FlowCluster = {
  key: string;
  kind: HermesArchitectureFlowKind;
  sourceNode: HermesNodeContext;
  edges: FlowEdgeCandidate[];
  targetNodeIds: Set<string>;
  importanceBase: number;
  shortTitle: string;
  goal: string;
  reason: string;
};

const FLOW_KIND_LIMIT = 2;
const FLOW_TOTAL_LIMIT = 8;

function flowEdgeRef(edge: FlowEdgeCandidate): HermesFlowEdgeRef {
  return edge.edgeId
    ? { edgeId: edge.edgeId }
    : {
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        type: edge.type,
      };
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function averageConfidence(edges: FlowEdgeCandidate[]) {
  const confidence = edges.reduce((sum, edge) => sum + (edge.confidence ?? 0.91), 0) / edges.length;
  return Math.min(0.96, Math.max(0.88, Number(confidence.toFixed(2))));
}

function clusterEvidence(
  cluster: FlowCluster,
  nodeById: ReadonlyMap<string, HermesNodeContext>,
): string[] {
  const evidence = cluster.edges.flatMap((edge) => [
    ...(edge.evidence ?? []),
    `${nodeById.get(edge.sourceNodeId)?.name ?? 'Source'} -> ${
      nodeById.get(edge.targetNodeId)?.name ?? 'Target'
    } (${edge.label ?? edge.type})`,
  ]);
  return uniqueStrings(evidence).slice(0, 8);
}

function buildClusterSteps(
  cluster: FlowCluster,
  nodeById: ReadonlyMap<string, HermesNodeContext>,
): HermesFlowStep[] {
  const targets = [...cluster.targetNodeIds]
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is HermesNodeContext => Boolean(node))
    .slice(0, 4);

  const firstEdgesByTarget = new Map<string, FlowEdgeCandidate>();
  for (const edge of cluster.edges) {
    if (!firstEdgesByTarget.has(edge.targetNodeId)) firstEdgesByTarget.set(edge.targetNodeId, edge);
  }

  const steps: HermesFlowStep[] = [
    {
      title: cluster.sourceNode.name,
      description: `Starts from the ${cluster.sourceNode.semanticKind ?? 'mapped'} node that owns this flow.`,
      nodeIds: [cluster.sourceNode._id],
    },
  ];

  for (const target of targets) {
    const edge = firstEdgesByTarget.get(target._id);
    steps.push({
      title: target.name,
      description: `Continues through ${edge?.label ?? edge?.type.replace(/_/g, ' ') ?? 'mapped relationship'}.`,
      nodeIds: [target._id],
      edgeRefs: edge ? [flowEdgeRef(edge)] : undefined,
    });
  }

  if (steps.length < 3 && cluster.edges[0]) {
    const edge = cluster.edges[0];
    steps.splice(1, 0, {
      title: edge.label ?? edge.type.replace(/_/g, ' '),
      description:
        'This relationship is kept because it represents an important agent, integration, or deployment handoff.',
      nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      edgeRefs: [flowEdgeRef(edge)],
    });
  }

  return steps.slice(0, 6);
}

function createFlowCluster(args: {
  key: string;
  kind: HermesArchitectureFlowKind;
  sourceNode: HermesNodeContext;
  edge: FlowEdgeCandidate;
  targetNodeId: string;
  importanceBase: number;
  shortTitle: string;
  goal: string;
  reason: string;
}): FlowCluster {
  return {
    key: args.key,
    kind: args.kind,
    sourceNode: args.sourceNode,
    edges: [args.edge],
    targetNodeIds: new Set([args.targetNodeId]),
    importanceBase: args.importanceBase,
    shortTitle: args.shortTitle,
    goal: args.goal,
    reason: args.reason,
  };
}

function pushCluster(
  clusters: Map<string, FlowCluster>,
  args: Parameters<typeof createFlowCluster>[0],
) {
  const existing = clusters.get(args.key);
  if (existing) {
    existing.edges.push(args.edge);
    existing.targetNodeIds.add(args.targetNodeId);
    return;
  }
  clusters.set(args.key, createFlowCluster(args));
}

function flowSuggestionFromCluster(
  cluster: FlowCluster,
  nodeById: ReadonlyMap<string, HermesNodeContext>,
): HermesArchitectureFlowSuggestion | null {
  const nodeIds = uniqueStrings([
    cluster.sourceNode._id,
    ...cluster.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
  ]).slice(0, 12);
  const edgeRefs = cluster.edges.slice(0, 12).map(flowEdgeRef);
  const evidence = clusterEvidence(cluster, nodeById);
  const isException =
    cluster.kind === 'agent_workflow' ||
    cluster.kind === 'integration' ||
    cluster.kind === 'build_deploy';
  if (nodeIds.length < 3 && edgeRefs.length < 2 && (!isException || evidence.length === 0)) {
    return null;
  }

  const targetNames = [...cluster.targetNodeIds]
    .map((nodeId) => nodeById.get(nodeId)?.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, 3);
  const confidence = averageConfidence(cluster.edges);
  const importance = Math.min(
    1,
    Number((cluster.importanceBase + Math.min(0.12, cluster.edges.length * 0.02)).toFixed(2)),
  );

  return {
    title:
      targetNames.length > 0
        ? `${cluster.shortTitle}: ${targetNames.join(', ')}`
        : cluster.shortTitle,
    shortTitle: cluster.shortTitle,
    goal: cluster.goal,
    importance,
    curationKey: cluster.key,
    description: `${cluster.goal} Involves ${nodeIds.length} mapped nodes and ${edgeRefs.length} relationship(s).`,
    kind: cluster.kind,
    nodeIds,
    edgeRefs,
    steps: buildClusterSteps(cluster, nodeById),
    confidence,
    reason: cluster.reason,
    evidence,
    source: 'hermes',
  };
}

function architectureFlowSuggestionsFromContext(
  context: HermesMappingContext,
  relationshipSuggestions: HermesRelationshipSuggestion[],
) {
  const nodeById = new Map(context.nodes.map((node) => [node._id, node]));
  const existingTitles = new Set(
    (context.flows ?? [])
      .filter((flow) => flow.status === 'applied' || flow.status === 'ignored')
      .map((flow) => flow.title.toLowerCase()),
  );
  const existingCurationKeys = new Set(
    (context.flows ?? [])
      .filter((flow) => flow.status === 'applied' || flow.status === 'ignored')
      .map((flow) => flow.curationKey?.toLowerCase())
      .filter((key): key is string => Boolean(key)),
  );
  const seen = new Set<string>();
  const clusters = new Map<string, FlowCluster>();
  const edges = buildFlowEdges(context, relationshipSuggestions);

  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.sourceNodeId);
    const targetNode = nodeById.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) continue;

    if (
      nodeMatches(sourceNode, context, ['surface', 'frontend', 'page', 'ui']) &&
      nodeMatches(targetNode, context, ['api', 'backend', 'data', 'storage', 'convex'])
    ) {
      pushCluster(clusters, {
        key: `user:${sourceNode._id}`,
        kind: edge.type === 'data_flow' ? 'data_flow' : 'user_journey',
        sourceNode,
        edge,
        targetNodeId: targetNode._id,
        importanceBase: 0.86,
        shortTitle: `${sourceNode.name} Journey`,
        goal: 'Show how this user-facing surface reaches application, backend, or data ownership.',
        reason:
          'Hermes grouped surface-to-backend relationships into one reviewable user-facing architecture flow.',
      });
    }

    if (
      edge.type === 'data_flow' &&
      !nodeMatches(sourceNode, context, ['surface', 'frontend', 'page', 'ui'])
    ) {
      pushCluster(clusters, {
        key: `data:${sourceNode._id}`,
        kind: edge.type === 'data_flow' ? 'data_flow' : 'user_journey',
        sourceNode,
        edge,
        targetNodeId: targetNode._id,
        importanceBase: 0.88,
        shortTitle: `${sourceNode.name} Data Path`,
        goal: 'Summarize where this node sends or writes data across the architecture.',
        reason:
          'Hermes merged related data-flow edges so the panel shows one data path instead of many pairwise edges.',
      });
    }

    if (
      nodeMatches(sourceNode, context, ['agent', 'mcp', 'hermes', 'worker']) ||
      nodeMatches(targetNode, context, ['agent', 'mcp', 'hermes', 'worker'])
    ) {
      const agentNode = nodeMatches(sourceNode, context, ['agent', 'mcp', 'hermes', 'worker'])
        ? sourceNode
        : targetNode;
      const otherNode = agentNode._id === sourceNode._id ? targetNode : sourceNode;
      pushCluster(clusters, {
        key: `agent:${agentNode._id}`,
        kind: 'agent_workflow',
        sourceNode: agentNode,
        edge,
        targetNodeId: otherNode._id,
        importanceBase: 0.9,
        shortTitle: `${agentNode.name} Workflow`,
        goal: 'Show where agent or worker activity changes the architecture map or surrounding systems.',
        reason:
          'Hermes grouped agent and worker relationships into a single workflow instead of separate update edges.',
      });
    }

    if (
      nodeMatches(sourceNode, context, ['build', 'deploy', 'infra', 'config']) ||
      nodeMatches(targetNode, context, ['build', 'deploy', 'infra', 'config'])
    ) {
      const infraNode = nodeMatches(sourceNode, context, ['build', 'deploy', 'infra', 'config'])
        ? sourceNode
        : targetNode;
      const otherNode = infraNode._id === sourceNode._id ? targetNode : sourceNode;
      pushCluster(clusters, {
        key: `deploy:${infraNode._id}`,
        kind: 'build_deploy',
        sourceNode: infraNode,
        edge,
        targetNodeId: otherNode._id,
        importanceBase: 0.78,
        shortTitle: `${infraNode.name} Delivery Flow`,
        goal: 'Summarize build, configuration, deployment, or quality handoffs.',
        reason: 'Hermes grouped infra-related relationships into one delivery flow for review.',
      });
    }

    if (
      nodeMatches(sourceNode, context, ['external', 'third party', 'integration']) ||
      nodeMatches(targetNode, context, ['external', 'third party', 'integration'])
    ) {
      const externalNode = nodeMatches(sourceNode, context, [
        'external',
        'third party',
        'integration',
      ])
        ? sourceNode
        : targetNode;
      const otherNode = externalNode._id === sourceNode._id ? targetNode : sourceNode;
      pushCluster(clusters, {
        key: `integration:${externalNode._id}`,
        kind: 'integration',
        sourceNode: externalNode,
        edge,
        targetNodeId: otherNode._id,
        importanceBase: 0.76,
        shortTitle: `${externalNode.name} Integration`,
        goal: 'Show the boundary between this codebase and external systems.',
        reason: 'Hermes grouped external-service relationships into one integration flow.',
      });
    }
  }

  const flows = [...clusters.values()]
    .map((cluster) => flowSuggestionFromCluster(cluster, nodeById))
    .filter((flow): flow is HermesArchitectureFlowSuggestion => Boolean(flow))
    .filter((flow) => {
      const titleKey = flow.title.toLowerCase();
      const curationKey = flow.curationKey?.toLowerCase();
      if (existingTitles.has(titleKey) || (curationKey && existingCurationKeys.has(curationKey))) {
        return false;
      }
      if (seen.has(flow.curationKey ?? titleKey)) return false;
      seen.add(flow.curationKey ?? titleKey);
      return true;
    })
    .sort(
      (a, b) =>
        (b.importance ?? 0) - (a.importance ?? 0) ||
        b.confidence - a.confidence ||
        b.nodeIds.length - a.nodeIds.length,
    );

  const perKind = new Map<HermesArchitectureFlowKind, number>();
  const selected: HermesArchitectureFlowSuggestion[] = [];
  for (const flow of flows) {
    const count = perKind.get(flow.kind) ?? 0;
    if (count >= FLOW_KIND_LIMIT) continue;
    perKind.set(flow.kind, count + 1);
    selected.push(flow);
    if (selected.length >= FLOW_TOTAL_LIMIT) break;
  }
  return selected;
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
        semanticKind: semanticKindForFact(path, fact),
        fileRole: fileRoleForFact(path, fact),
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
        semanticKind: semanticKindForFact(path, fact),
        fileRole: fileRoleForFact(path, fact),
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
        semanticKind: semanticKindForFact(path, fact),
        fileRole: fileRoleForFact(path, fact),
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
        semanticKind: semanticKindForFact(path, fact),
        fileRole: fileRoleForFact(path, fact),
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
      semanticKind: semanticKindForFact(path, fact),
      fileRole: fileRoleForFact(path, fact),
      source: 'hermes',
    });
  }

  const relationshipSuggestions = relationshipSuggestionsFromImports(context, factByPath);

  return {
    suggestions,
    relationshipSuggestions,
    flowSuggestions: architectureFlowSuggestionsFromContext(context, relationshipSuggestions),
  };
}
