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
  productArea?: ProductArea;
  capabilityKey?: string;
  routeHint?: string;
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
  productArea?: ProductArea;
  capabilityHints?: string[];
  textHints?: string[];
  componentRefs?: string[];
  ctaHints?: string[];
  uiBlocks?: HermesUiBlockFact[];
}

export type ProductArea = 'public' | 'user' | 'admin' | 'extension' | 'internal' | 'unknown';

export interface HermesUiBlockFact {
  key: string;
  name: string;
  kind?: string;
  labels?: string[];
  evidence?: string[];
  routeHint?: string;
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

export type HermesRelationshipSuggestionType =
  | 'dependency'
  | 'navigation'
  | 'data_flow'
  | 'contains'
  | 'uses'
  | 'triggers'
  | 'reads'
  | 'writes'
  | 'integrates';

export interface HermesExistingRelationshipSuggestion {
  sourceNodeId: string;
  targetNodeId: string;
  type: HermesRelationshipSuggestionType;
  label?: string;
  status: 'pending' | 'applied' | 'rejected' | 'ignored';
  confidence: number;
}

export interface HermesExistingSemanticNodeSuggestion {
  sourceFilePath: string;
  semanticKey: string;
  suggestedNodeName: string;
  semanticKind: string;
  productArea: ProductArea;
  capabilityKey?: string;
  routeHint?: string;
  layerId: string;
  parentNodeId?: string;
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
  semanticNodeSuggestions?: HermesExistingSemanticNodeSuggestion[];
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

export interface HermesSemanticNodeSuggestion {
  sourceFilePath: string;
  semanticKey: string;
  suggestedNodeName: string;
  semanticKind: string;
  productArea: ProductArea;
  capabilityKey?: string;
  routeHint?: string;
  layerId: string;
  parentNodeId?: string;
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
  productArea?: ProductArea;
  source: string;
}

export interface HermesMappingResult {
  suggestions: HermesMappingSuggestion[];
  semanticNodeSuggestions?: HermesSemanticNodeSuggestion[];
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
    normalizedNames
      .map((name) => layers.find((layer) => layer.name.toLowerCase() === name))
      .find((layer): layer is HermesLayerContext => Boolean(layer)) ??
    normalizedNames
      .map((name) => layers.find((layer) => layer.name.toLowerCase().includes(name)))
      .find((layer): layer is HermesLayerContext => Boolean(layer)) ??
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
    if (!fact?.routeHint && ((fact?.uiBlocks?.length ?? 0) > 0 || fact?.productArea)) {
      return layerByName(layers, ['UI Modules', 'Surfaces']);
    }
    return layerByName(layers, ['Surfaces']);
  }
  return layerByName(layers, ['Application', 'Features', 'Surfaces']);
}

function semanticKindForFact(path: string, fact?: HermesFileFact) {
  const lower = normalized(path).toLowerCase();
  const kind = fact?.kind;
  if (kind === 'component') return fact?.routeHint ? 'surface' : 'ui_module';
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
  if (fact?.productArea) evidence.add(`product area ${fact.productArea}`);
  if (fact?.apiHint) evidence.add(`api ${fact.apiHint}`);
  for (const block of fact?.uiBlocks?.slice(0, 2) ?? []) evidence.add(`ui block ${block.name}`);
  for (const capability of fact?.capabilityHints?.slice(0, 2) ?? []) {
    evidence.add(`capability ${capability.replace(/_/g, ' ')}`);
  }
  for (const exported of fact?.exports?.slice(0, 2) ?? []) evidence.add(`exports ${exported}`);
  for (const imported of fact?.imports?.slice(0, 2) ?? []) evidence.add(`imports ${imported}`);
  if (evidence.size === 0) evidence.add(`path ${normalized(path)}`);
  return [...evidence].slice(0, 8);
}

function productAreaForFact(path: string, fact?: HermesFileFact): ProductArea {
  if (fact?.productArea) return fact.productArea;
  const lower = normalized(path).toLowerCase();
  if (lower.includes('/admin') || lower.includes('admin')) return 'admin';
  if (lower.includes('extension') || lower.includes('chrome')) return 'extension';
  if (lower.includes('/api/') || lower.startsWith('convex/') || lower.startsWith('apps/vps-api/')) {
    return 'internal';
  }
  if (
    lower.includes('dashboard') ||
    lower.includes('account') ||
    lower.includes('billing') ||
    lower.includes('profile') ||
    lower.includes('/plan') ||
    lower.includes('notification') ||
    lower.includes('support')
  ) {
    return 'user';
  }
  return fact?.kind === 'component' ? 'public' : 'unknown';
}

function capabilityName(key: string) {
  const labels: Record<string, string> = {
    onboarding: 'Onboarding',
    billing_subscription: 'Billing & Subscription',
    notifications: 'Notifications',
    localization: 'Localization',
    profile: 'Profile',
    admin_operations: 'Admin Operations',
    extension_services: 'Extension Services',
    feature_updates: 'Feature Updates',
    user_control: 'User Control',
    plan_catalog: 'Plan Catalog',
    support_ops: 'Support Operations',
    content_workflow: 'Content Workflow',
    referrals: 'Referrals',
    api_keys: 'API Keys',
    data_state: 'Data & State',
    agent_mission_control: 'Agent Mission Control',
  };
  return labels[key] ?? toTitle(key.replace(/_/g, ' '));
}

function routeKeyFor(path: string, fact: HermesFileFact | undefined, route: string | undefined) {
  return (route ?? fact?.routeHint ?? fact?.uiBlocks?.[0]?.routeHint ?? normalized(path)).replace(
    /[^a-zA-Z0-9/_-]+/g,
    '-',
  );
}

function semanticRouteKey(
  path: string,
  fact: HermesFileFact | undefined,
  route: string | undefined,
) {
  return routeKeyFor(path, fact, route).toLowerCase();
}

function capabilitySemanticKey(args: {
  capabilityKey: string;
  productArea: ProductArea;
  path: string;
  fact: HermesFileFact;
  route?: string;
}) {
  const routeKey = args.route ? semanticRouteKey(args.path, args.fact, args.route) : undefined;
  return routeKey
    ? `capability:${args.productArea}:${routeKey}:${args.capabilityKey}`
    : `capability:${args.productArea}:${args.capabilityKey}`;
}

function findLayer(context: HermesMappingContext, names: string[]) {
  return layerByName(context.layers, names);
}

function surfaceNodeForFact(
  context: HermesMappingContext,
  fact: HermesFileFact,
  nodeByFile: Map<string, HermesNodeContext>,
) {
  const direct = nodeByFile.get(normalized(fact.path));
  if (direct && (direct.semanticKind === 'surface' || direct.type === 'page')) return direct;
  if (fact.routeHint) {
    const lastSegment = fact.routeHint.split('/').filter(Boolean).at(-1) ?? 'home';
    return (
      context.nodes.find((node) => node.routeHint === fact.routeHint) ??
      context.nodes.find(
        (node) =>
          node.semanticKind === 'surface' &&
          node.name.toLowerCase().includes(lastSegment.replace(/[-_]/g, ' ')),
      ) ??
      null
    );
  }
  return null;
}

function surfaceRouteForFact(fact: HermesFileFact) {
  const route = fact.routeHint ?? fact.uiBlocks?.find((block) => block.routeHint)?.routeHint;
  if (!route || route.startsWith('/api')) return undefined;
  return route;
}

interface SurfaceOwnership {
  routeHint?: string;
  surfaceNode?: HermesNodeContext | null;
  distance: number;
}

function shouldPropagateSurfaceOwnership(fact: HermesFileFact | undefined) {
  if (!fact) return false;
  if (fact.kind === 'generated' || fact.kind === 'test' || fact.kind === 'config') return false;
  return (
    fact.kind === 'component' ||
    (fact.uiBlocks?.length ?? 0) > 0 ||
    (fact.capabilityHints?.length ?? 0) > 0
  );
}

function findSurfaceNodeForRoute(context: HermesMappingContext, route: string | undefined) {
  if (!route) return null;
  const lastSegment = route.split('/').filter(Boolean).at(-1) ?? 'home';
  return (
    context.nodes.find((node) => node.routeHint === route) ??
    context.nodes.find(
      (node) =>
        node.semanticKind === 'surface' &&
        node.name.toLowerCase().includes(lastSegment.replace(/[-_]/g, ' ')),
    ) ??
    null
  );
}

function buildSurfaceOwnership(
  context: HermesMappingContext,
  factByPath: Map<string, HermesFileFact>,
  nodeByFile: Map<string, HermesNodeContext>,
) {
  const ownership = new Map<string, SurfaceOwnership>();
  const facts = [...factByPath.values()].sort((a, b) =>
    normalized(a.path).localeCompare(normalized(b.path)),
  );

  for (const fact of facts) {
    const path = normalized(fact.path);
    const route = surfaceRouteForFact(fact);
    const directSurface = surfaceNodeForFact(context, fact, nodeByFile);
    if (!route && !directSurface) continue;
    ownership.set(path, {
      routeHint: route ?? directSurface?.routeHint,
      surfaceNode: directSurface ?? findSurfaceNodeForRoute(context, route),
      distance: 0,
    });
  }

  const queue = [...ownership.entries()]
    .filter(([, owner]) => Boolean(owner.routeHint || owner.surfaceNode))
    .map(([path, owner]) => ({ path, owner }));
  const maxDistance = 8;

  for (let index = 0; index < queue.length; index += 1) {
    const { path, owner } = queue[index]!;
    if (owner.distance >= maxDistance) continue;
    const fact = factByPath.get(path);
    if (!fact) continue;

    for (const imported of fact.resolvedImports ?? []) {
      const importedPath = normalized(imported);
      const importedFact = factByPath.get(importedPath);
      if (!shouldPropagateSurfaceOwnership(importedFact)) continue;
      const nextOwner: SurfaceOwnership = {
        routeHint: owner.routeHint,
        surfaceNode: owner.surfaceNode,
        distance: owner.distance + 1,
      };
      const existing = ownership.get(importedPath);
      if (existing && existing.distance <= nextOwner.distance) continue;
      ownership.set(importedPath, nextOwner);
      queue.push({ path: importedPath, owner: nextOwner });
    }
  }

  return ownership;
}

function buildSemanticSuggestionKeys(context: HermesMappingContext) {
  return new Set(
    (context.semanticNodeSuggestions ?? [])
      .filter((suggestion) => suggestion.status === 'applied' || suggestion.status === 'ignored')
      .map((suggestion) => suggestion.semanticKey.toLowerCase()),
  );
}

function pushSemanticSuggestion(
  out: HermesSemanticNodeSuggestion[],
  seen: Set<string>,
  suggestion: HermesSemanticNodeSuggestion,
) {
  const key = suggestion.semanticKey.toLowerCase();
  const existingIndex = out.findIndex((candidate) => candidate.semanticKey.toLowerCase() === key);
  if (existingIndex >= 0) {
    const existing = out[existingIndex]!;
    const existingScore =
      existing.confidence + (existing.parentNodeId ? 0.05 : 0) + (existing.routeHint ? 0.03 : 0);
    const nextScore =
      suggestion.confidence +
      (suggestion.parentNodeId ? 0.05 : 0) +
      (suggestion.routeHint ? 0.03 : 0);
    if (nextScore > existingScore) out[existingIndex] = suggestion;
    return;
  }
  if (seen.has(key)) return;
  seen.add(key);
  out.push(suggestion);
}

function semanticNodeSuggestionsFromFacts(
  context: HermesMappingContext,
  factByPath: Map<string, HermesFileFact>,
) {
  const surfaceLayer = findLayer(context, ['Surfaces']);
  const uiLayer = findLayer(context, ['UI Modules', 'Surfaces']);
  const capabilityLayer = findLayer(context, ['Product Capabilities', 'Application', 'Features']);
  const nodeByFile = buildNodeByFile(context.nodes);
  const ownershipByPath = buildSurfaceOwnership(context, factByPath, nodeByFile);
  const seen = buildSemanticSuggestionKeys(context);
  const suggestions: HermesSemanticNodeSuggestion[] = [];

  const facts = [...factByPath.values()]
    .filter((fact) => fact.kind !== 'generated' && fact.kind !== 'test' && fact.kind !== 'config')
    .filter(
      (fact) =>
        fact.kind === 'component' ||
        Boolean(fact.routeHint) ||
        (fact.uiBlocks?.length ?? 0) > 0 ||
        (fact.capabilityHints?.length ?? 0) > 0,
    )
    .sort((a, b) => normalized(a.path).localeCompare(normalized(b.path)))
    .slice(0, 300);

  for (const fact of facts) {
    const path = normalized(fact.path);
    const evidence = evidenceFor(path, fact);
    const owner = ownershipByPath.get(path);
    const existingSurface = surfaceNodeForFact(context, fact, nodeByFile) ?? owner?.surfaceNode;
    const route = surfaceRouteForFact(fact) ?? owner?.routeHint;
    const area = existingSurface?.productArea ?? productAreaForFact(path, fact);

    if (route && !existingSurface && surfaceLayer) {
      pushSemanticSuggestion(suggestions, seen, {
        sourceFilePath: path,
        semanticKey: `surface:${route}`,
        suggestedNodeName: `${titleFromPath(path)} Surface`,
        semanticKind: 'surface',
        productArea: area,
        routeHint: route,
        layerId: surfaceLayer._id,
        confidence: 0.9,
        reason: `Route ${route} is a user-facing surface and should anchor UI modules.`,
        evidence,
        source: 'hermes',
      });
    }

    for (const capabilityKey of fact.capabilityHints ?? []) {
      if (!capabilityLayer) continue;
      pushSemanticSuggestion(suggestions, seen, {
        sourceFilePath: path,
        semanticKey: capabilitySemanticKey({ capabilityKey, productArea: area, path, fact, route }),
        suggestedNodeName: capabilityName(capabilityKey),
        semanticKind: 'capability',
        productArea: area,
        capabilityKey,
        routeHint: route,
        layerId: capabilityLayer._id,
        confidence: 0.9,
        reason: `${capabilityName(capabilityKey)} appears as a product function in this file.`,
        evidence,
        source: 'hermes',
      });
    }

    for (const block of fact.uiBlocks ?? []) {
      if (!uiLayer) continue;
      const capabilityKey = block.key === 'header_controls' ? undefined : block.key;
      pushSemanticSuggestion(suggestions, seen, {
        sourceFilePath: path,
        semanticKey: `ui:${routeKeyFor(path, fact, route)}:${block.key}`,
        suggestedNodeName: block.name,
        semanticKind: 'ui_module',
        productArea: area,
        capabilityKey,
        routeHint: block.routeHint ?? route,
        layerId: uiLayer._id,
        parentNodeId: existingSurface?._id,
        confidence: existingSurface ? 0.9 : 0.86,
        reason: `${block.name} is a visible UI module inside ${route ?? titleFromPath(path)}.`,
        evidence: uniqueStrings([
          ...evidence,
          ...(block.evidence ?? []),
          ...(block.labels ?? []),
        ]).slice(0, 8),
        source: 'hermes',
      });
    }
  }

  return suggestions.slice(0, 500);
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

function relationshipSuggestionsFromSemanticNodes(context: HermesMappingContext) {
  const existingKeys = buildRelationshipKeys(context);
  const suggestions: HermesRelationshipSuggestion[] = [];
  const nodesByCapability = new Map<string, HermesNodeContext[]>();
  for (const node of context.nodes) {
    if (!node.capabilityKey) continue;
    const list = nodesByCapability.get(node.capabilityKey) ?? [];
    list.push(node);
    nodesByCapability.set(node.capabilityKey, list);
  }

  for (const node of context.nodes) {
    if (node.parentId && node.semanticKind === 'ui_module') {
      const key = existingRelationshipKey(node.parentId, node._id, 'contains');
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        suggestions.push({
          sourceNodeId: node.parentId,
          targetNodeId: node._id,
          type: 'contains',
          label: 'contains',
          confidence: 0.92,
          reason: `${node.name} is a visible module under its parent surface.`,
          evidence: [`${node.name} parentId ${node.parentId}`],
          source: 'hermes',
        });
      }
    }

    if (node.semanticKind !== 'ui_module' || !node.capabilityKey) continue;
    const capabilities = (nodesByCapability.get(node.capabilityKey) ?? []).filter(
      (candidate) => candidate.semanticKind === 'capability' && candidate._id !== node._id,
    );
    for (const capability of capabilities) {
      const type: HermesRelationshipSuggestionType =
        node.capabilityKey === 'billing_subscription' ? 'triggers' : 'uses';
      const key = existingRelationshipKey(node._id, capability._id, type);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      suggestions.push({
        sourceNodeId: node._id,
        targetNodeId: capability._id,
        type,
        label: node.capabilityKey.replace(/_/g, ' '),
        confidence: 0.92,
        reason: `${node.name} is UI evidence for ${capability.name}.`,
        evidence: [`shared capabilityKey ${node.capabilityKey}`],
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
const FLOW_TITLE_MAX_LENGTH = 120;

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

function truncateFlowTitle(title: string) {
  if (title.length <= FLOW_TITLE_MAX_LENGTH) return title;
  return `${title.slice(0, FLOW_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
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

  const title =
    targetNames.length > 0
      ? `${cluster.shortTitle}: ${targetNames.join(', ')}`
      : cluster.shortTitle;

  return {
    title: truncateFlowTitle(title),
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

  const semanticNodeSuggestions = semanticNodeSuggestionsFromFacts(context, factByPath);
  const relationshipSuggestions = [
    ...relationshipSuggestionsFromImports(context, factByPath),
    ...relationshipSuggestionsFromSemanticNodes(context),
  ].slice(0, 500);

  return {
    suggestions,
    semanticNodeSuggestions,
    relationshipSuggestions,
    flowSuggestions: architectureFlowSuggestionsFromContext(context, relationshipSuggestions),
  };
}
