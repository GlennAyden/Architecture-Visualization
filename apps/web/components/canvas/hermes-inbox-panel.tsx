'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Bot, Check, GitBranch, Pencil, Play, RotateCw, ShieldCheck, X } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: Id<'projects'>;
}

type SuggestionAction = 'create_node' | 'link_existing_node' | 'group_into_node' | 'ignore';

const ACTION_LABELS: Record<SuggestionAction, string> = {
  create_node: 'Create node',
  link_existing_node: 'Link existing',
  group_into_node: 'Group files',
  ignore: 'Ignore',
};

const ACTION_OPTIONS: SuggestionAction[] = [
  'create_node',
  'link_existing_node',
  'group_into_node',
  'ignore',
];

const SEMANTIC_KIND_OPTIONS = [
  'surface',
  'ui_module',
  'capability',
  'api',
  'data_logic',
  'agent',
  'worker',
  'storage',
  'external_service',
  'config',
  'test_harness',
  'unknown',
] as const;

const PRODUCT_AREA_OPTIONS = [
  'public',
  'user',
  'admin',
  'extension',
  'internal',
  'unknown',
] as const;

const FILE_ROLE_OPTIONS = [
  'primary',
  'ui',
  'route',
  'api',
  'schema',
  'query',
  'mutation',
  'worker',
  'config',
  'test',
  'support',
] as const;

type SemanticKind = (typeof SEMANTIC_KIND_OPTIONS)[number];
type FileRole = (typeof FILE_ROLE_OPTIONS)[number];
type ProductArea = (typeof PRODUCT_AREA_OPTIONS)[number];
type ReviewDraft = {
  action: SuggestionAction;
  layerId: string;
  targetNodeId: string;
  groupKey: string;
  suggestedNodeName: string;
  semanticKind: SemanticKind | '';
  fileRole: FileRole | '';
};
type SemanticReviewDraft = {
  suggestedNodeName: string;
  semanticKind: SemanticKind;
  productArea: ProductArea;
  capabilityKey: string;
  routeHint: string;
  layerId: string;
  parentNodeId: string;
};

function isHighConfidence(action: SuggestionAction, confidence: number) {
  return action === 'link_existing_node' || action === 'ignore'
    ? confidence >= 0.9
    : confidence >= 0.85;
}

function isHighConfidenceSemantic(semanticKind: string, confidence: number) {
  return semanticKind === 'ui_module' ? confidence >= 0.88 : confidence >= 0.9;
}

function statusTone(status?: string) {
  if (status === 'completed') return 'text-emerald-300';
  if (status === 'failed') return 'text-rose-300';
  if (status === 'running' || status === 'queued') return 'text-amber-300';
  return 'text-zinc-500';
}

export function HermesInboxPanel({ projectId }: Props) {
  const pending = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const applied = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'applied',
  });
  const ignored = useQuery(api.codebaseSuggestions.listByProject, {
    projectId,
    status: 'ignored',
  });
  const pendingSemantic = useQuery(api.semanticNodeSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const appliedSemantic = useQuery(api.semanticNodeSuggestions.listByProject, {
    projectId,
    status: 'applied',
  });
  const ignoredSemantic = useQuery(api.semanticNodeSuggestions.listByProject, {
    projectId,
    status: 'ignored',
  });
  const pendingRelationships = useQuery(api.relationshipSuggestions.listByProject, {
    projectId,
    status: 'pending',
  });
  const appliedRelationships = useQuery(api.relationshipSuggestions.listByProject, {
    projectId,
    status: 'applied',
  });
  const ignoredRelationships = useQuery(api.relationshipSuggestions.listByProject, {
    projectId,
    status: 'ignored',
  });
  const pendingFlows = useQuery(api.architectureFlows.listByProject, {
    projectId,
    status: 'pending',
  });
  const appliedFlows = useQuery(api.architectureFlows.listByProject, {
    projectId,
    status: 'applied',
  });
  const ignoredFlows = useQuery(api.architectureFlows.listByProject, {
    projectId,
    status: 'ignored',
  });
  const runs = useQuery(api.hermesMappingRuns.latestByProject, { projectId });
  const layers = useQuery(api.projectLayers.listByProject, { projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });
  const apply = useMutation(api.codebaseSuggestions.apply);
  const reject = useMutation(api.codebaseSuggestions.reject);
  const ignore = useMutation(api.codebaseSuggestions.ignore);
  const updateReview = useMutation(api.codebaseSuggestions.updateReview);
  const bulkApply = useMutation(api.codebaseSuggestions.applyHighConfidence);
  const applyAll = useMutation(api.codebaseSuggestions.applyAllPending);
  const ignoreAll = useMutation(api.codebaseSuggestions.ignoreAllPending);
  const rejectAll = useMutation(api.codebaseSuggestions.rejectAllPending);
  const applySemantic = useMutation(api.semanticNodeSuggestions.apply);
  const rejectSemantic = useMutation(api.semanticNodeSuggestions.reject);
  const ignoreSemantic = useMutation(api.semanticNodeSuggestions.ignore);
  const updateSemanticReview = useMutation(api.semanticNodeSuggestions.updateReview);
  const bulkApplySemantic = useMutation(api.semanticNodeSuggestions.applyHighConfidence);
  const applyAllSemantic = useMutation(api.semanticNodeSuggestions.applyAllPending);
  const ignoreAllSemantic = useMutation(api.semanticNodeSuggestions.ignoreAllPending);
  const rejectAllSemantic = useMutation(api.semanticNodeSuggestions.rejectAllPending);
  const applyRelationship = useMutation(api.relationshipSuggestions.apply);
  const rejectRelationship = useMutation(api.relationshipSuggestions.reject);
  const ignoreRelationship = useMutation(api.relationshipSuggestions.ignore);
  const bulkApplyRelationships = useMutation(api.relationshipSuggestions.applyHighConfidence);
  const applyAllRelationships = useMutation(api.relationshipSuggestions.applyAllPending);
  const ignoreAllRelationships = useMutation(api.relationshipSuggestions.ignoreAllPending);
  const rejectAllRelationships = useMutation(api.relationshipSuggestions.rejectAllPending);
  const applyFlow = useMutation(api.architectureFlows.apply);
  const rejectFlow = useMutation(api.architectureFlows.reject);
  const ignoreFlow = useMutation(api.architectureFlows.ignore);
  const bulkApplyFlows = useMutation(api.architectureFlows.applyHighConfidence);
  const applyAllFlows = useMutation(api.architectureFlows.applyAllPending);
  const ignoreAllFlows = useMutation(api.architectureFlows.ignoreAllPending);
  const rejectAllFlows = useMutation(api.architectureFlows.rejectAllPending);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id<'codebaseSuggestions'> | null>(null);
  const [editingSemanticId, setEditingSemanticId] = useState<Id<'semanticNodeSuggestions'> | null>(
    null,
  );
  const [draft, setDraft] = useState<ReviewDraft>({
    action: 'create_node',
    layerId: '',
    targetNodeId: '',
    groupKey: '',
    suggestedNodeName: '',
    semanticKind: '',
    fileRole: '',
  });
  const [semanticDraft, setSemanticDraft] = useState<SemanticReviewDraft>({
    suggestedNodeName: '',
    semanticKind: 'ui_module',
    productArea: 'unknown',
    capabilityKey: '',
    routeHint: '',
    layerId: '',
    parentNodeId: '',
  });

  const visiblePending = pending?.slice(0, 5) ?? [];
  const visibleSemanticPending = pendingSemantic?.slice(0, 5) ?? [];
  const visibleRelationshipPending = pendingRelationships?.slice(0, 4) ?? [];
  const visibleApplied = applied?.slice(0, 3) ?? [];
  const visibleIgnored = ignored?.slice(0, 3) ?? [];
  const visibleSemanticApplied = appliedSemantic?.slice(0, 3) ?? [];
  const visibleSemanticIgnored = ignoredSemantic?.slice(0, 3) ?? [];
  const visibleRelationshipApplied = appliedRelationships?.slice(0, 2) ?? [];
  const visibleRelationshipIgnored = ignoredRelationships?.slice(0, 2) ?? [];
  const visibleFlowPending = pendingFlows?.slice(0, 3) ?? [];
  const visibleFlowApplied = appliedFlows?.slice(0, 2) ?? [];
  const visibleFlowIgnored = ignoredFlows?.slice(0, 2) ?? [];
  const latestRun = runs?.[0];
  const highConfidenceCount = useMemo(
    () =>
      (pending ?? []).filter((suggestion) =>
        isHighConfidence(suggestion.action as SuggestionAction, suggestion.confidence),
      ).length +
      (pendingSemantic ?? []).filter((suggestion) =>
        isHighConfidenceSemantic(suggestion.semanticKind, suggestion.confidence),
      ).length +
      (pendingRelationships ?? []).filter((suggestion) => suggestion.confidence >= 0.9).length +
      (pendingFlows ?? []).filter((flow) => flow.confidence >= 0.9).length,
    [pending, pendingFlows, pendingRelationships, pendingSemantic],
  );

  const handleStartRun = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/hermes/mapping-runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Hermes mapping could not start');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hermes mapping could not start');
    } finally {
      setStarting(false);
    }
  };

  const handleApply = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await apply({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await reject({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleIgnore = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await ignore({ id });
    } finally {
      setBusyId(null);
    }
  };

  const beginEdit = (suggestion: (typeof visiblePending)[number]) => {
    setEditingId(suggestion._id);
    setDraft({
      action: suggestion.action as SuggestionAction,
      layerId: suggestion.layerId ?? '',
      targetNodeId: suggestion.targetNodeId ?? '',
      groupKey: suggestion.groupKey ?? '',
      suggestedNodeName: suggestion.suggestedNodeName,
      semanticKind: suggestion.semanticKind ?? '',
      fileRole: suggestion.fileRole ?? '',
    });
  };

  const saveEdit = async (id: Id<'codebaseSuggestions'>) => {
    setBusyId(id);
    try {
      await updateReview({
        id,
        action: draft.action,
        layerId: draft.layerId ? (draft.layerId as Id<'projectLayers'>) : undefined,
        targetNodeId: draft.targetNodeId ? (draft.targetNodeId as Id<'nodes'>) : undefined,
        groupKey: draft.groupKey.trim() || undefined,
        suggestedNodeName: draft.suggestedNodeName.trim() || undefined,
        semanticKind: draft.semanticKind || undefined,
        fileRole: draft.fileRole || undefined,
      });
      setEditingId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleSemanticApply = async (id: Id<'semanticNodeSuggestions'>) => {
    setBusyId(id);
    try {
      await applySemantic({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleSemanticReject = async (id: Id<'semanticNodeSuggestions'>) => {
    setBusyId(id);
    try {
      await rejectSemantic({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleSemanticIgnore = async (id: Id<'semanticNodeSuggestions'>) => {
    setBusyId(id);
    try {
      await ignoreSemantic({ id });
    } finally {
      setBusyId(null);
    }
  };

  const beginSemanticEdit = (suggestion: (typeof visibleSemanticPending)[number]) => {
    setEditingSemanticId(suggestion._id);
    setSemanticDraft({
      suggestedNodeName: suggestion.suggestedNodeName,
      semanticKind: suggestion.semanticKind,
      productArea: suggestion.productArea,
      capabilityKey: suggestion.capabilityKey ?? '',
      routeHint: suggestion.routeHint ?? '',
      layerId: suggestion.layerId,
      parentNodeId: suggestion.parentNodeId ?? '',
    });
  };

  const saveSemanticEdit = async (id: Id<'semanticNodeSuggestions'>) => {
    setBusyId(id);
    try {
      await updateSemanticReview({
        id,
        suggestedNodeName: semanticDraft.suggestedNodeName.trim() || undefined,
        semanticKind: semanticDraft.semanticKind,
        productArea: semanticDraft.productArea,
        capabilityKey: semanticDraft.capabilityKey.trim() || undefined,
        routeHint: semanticDraft.routeHint.trim() || undefined,
        layerId: semanticDraft.layerId as Id<'projectLayers'>,
        parentNodeId: semanticDraft.parentNodeId
          ? (semanticDraft.parentNodeId as Id<'nodes'>)
          : undefined,
      });
      setEditingSemanticId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleBulkApply = async () => {
    setBusyId('bulk');
    try {
      await bulkApply({ projectId });
      await bulkApplySemantic({ projectId });
      await bulkApplyRelationships({ projectId });
      await bulkApplyFlows({ projectId });
    } finally {
      setBusyId(null);
    }
  };

  type BulkResult = { applied: number; ignored: number; rejected: number; failed: number };
  const runBulkAction = async (label: string, count: number, action: () => Promise<BulkResult>) => {
    if (count === 0) return;
    const ok = window.confirm(`${label} ${count} pending items?`);
    if (!ok) return;
    setBusyId(`bulk:${label}`);
    setBulkResult(null);
    try {
      const result = await action();
      setBulkResult(
        `${label}: ${result.applied} applied, ${result.ignored} ignored, ${result.rejected} rejected, ${result.failed} failed`,
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRelationshipApply = async (id: Id<'relationshipSuggestions'>) => {
    setBusyId(id);
    try {
      await applyRelationship({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleRelationshipReject = async (id: Id<'relationshipSuggestions'>) => {
    setBusyId(id);
    try {
      await rejectRelationship({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleRelationshipIgnore = async (id: Id<'relationshipSuggestions'>) => {
    setBusyId(id);
    try {
      await ignoreRelationship({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleFlowApply = async (id: Id<'architectureFlows'>) => {
    setBusyId(id);
    try {
      await applyFlow({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleFlowReject = async (id: Id<'architectureFlows'>) => {
    setBusyId(id);
    try {
      await rejectFlow({ id });
    } finally {
      setBusyId(null);
    }
  };

  const handleFlowIgnore = async (id: Id<'architectureFlows'>) => {
    setBusyId(id);
    try {
      await ignoreFlow({ id });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/80 p-3 shadow-2xl shadow-black/30">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
          Hermes Inbox
        </h2>
        <Bot className="h-4 w-4 text-emerald-300" />
      </div>

      <div className="mb-3 rounded-md border border-cyan-400/20 bg-cyan-400/5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-100">Mapping review</p>
            <p className={`mt-0.5 truncate text-xs ${statusTone(latestRun?.status)}`}>
              {latestRun
                ? `${latestRun.status} · ${latestRun.suggestedCount} suggested · ${latestRun.appliedCount} applied`
                : 'No mapping run yet'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20"
            disabled={starting}
            onClick={() => void handleStartRun()}
          >
            {starting ? (
              <RotateCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Ask Hermes
          </Button>
        </div>
        {latestRun?.errorMessage && (
          <p className="mt-2 rounded border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-xs text-rose-200">
            {latestRun.errorMessage}
          </p>
        )}
        {error && (
          <p className="mt-2 rounded border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-xs text-rose-200">
            {error}
          </p>
        )}
      </div>

      {highConfidenceCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 h-8 w-full border border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20"
          disabled={busyId !== null}
          onClick={() => void handleBulkApply()}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Bulk apply high-confidence ({highConfidenceCount})
        </Button>
      )}

      {bulkResult && (
        <p className="mb-3 rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-100">
          {bulkResult}
        </p>
      )}

      {pending === undefined ? (
        <p className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-500">
          Loading suggestions...
        </p>
      ) : visiblePending.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/10 p-3 text-sm text-zinc-500">
          No pending suggestions.
        </p>
      ) : (
        <div className="space-y-2">
          <ReviewSectionHeader
            title="Needs review"
            count={pending.length}
            disabled={busyId !== null}
            onApply={() =>
              void runBulkAction('Apply mapping suggestions', pending.length, () =>
                applyAll({ projectId }),
              )
            }
            onIgnore={() =>
              void runBulkAction('Ignore mapping suggestions', pending.length, () =>
                ignoreAll({ projectId }),
              )
            }
            onReject={() =>
              void runBulkAction('Reject mapping suggestions', pending.length, () =>
                rejectAll({ projectId }),
              )
            }
          />
          {visiblePending.map((suggestion) => {
            const isEditing = editingId === suggestion._id;
            return (
              <div
                key={suggestion._id}
                className="rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {suggestion.suggestedNodeName}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                      {suggestion.filePath}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                </div>

                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={draft.suggestedNodeName}
                      onChange={(event) =>
                        setDraft((prev) => ({ ...prev, suggestedNodeName: event.target.value }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    />
                    <select
                      value={draft.action}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          action: event.target.value as SuggestionAction,
                        }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    >
                      {ACTION_OPTIONS.map((action) => (
                        <option key={action} value={action}>
                          {ACTION_LABELS[action]}
                        </option>
                      ))}
                    </select>
                    {(draft.action === 'create_node' || draft.action === 'group_into_node') && (
                      <select
                        value={draft.layerId}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, layerId: event.target.value }))
                        }
                        className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                      >
                        <option value="">Pick layer</option>
                        {(layers ?? []).map((layer) => (
                          <option key={layer._id} value={layer._id}>
                            {layer.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <select
                      value={draft.semanticKind}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          semanticKind: event.target.value as SemanticKind | '',
                        }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    >
                      <option value="">Semantic kind</option>
                      {SEMANTIC_KIND_OPTIONS.map((kind) => (
                        <option key={kind} value={kind}>
                          {kind.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draft.fileRole}
                      onChange={(event) =>
                        setDraft((prev) => ({
                          ...prev,
                          fileRole: event.target.value as FileRole | '',
                        }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    >
                      <option value="">File role</option>
                      {FILE_ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    {draft.action === 'link_existing_node' && (
                      <select
                        value={draft.targetNodeId}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, targetNodeId: event.target.value }))
                        }
                        className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                      >
                        <option value="">Pick node</option>
                        {(nodes ?? []).map((node) => (
                          <option key={node._id} value={node._id}>
                            {node.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {draft.action === 'group_into_node' && (
                      <input
                        value={draft.groupKey}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, groupKey: event.target.value }))
                        }
                        placeholder="Stable group key"
                        className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                      />
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                        disabled={busyId !== null}
                        onClick={() => void saveEdit(suggestion._id)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 grid gap-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-cyan-200">
                          {ACTION_LABELS[suggestion.action as SuggestionAction]}
                        </span>
                        <span className="truncate text-zinc-500">
                          {suggestion.targetNodeName ?? suggestion.layerName ?? 'No target'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-zinc-500">
                          {suggestion.semanticKind
                            ? suggestion.semanticKind.replace(/_/g, ' ')
                            : 'semantic unknown'}
                        </span>
                        <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-zinc-400">
                          {suggestion.fileRole ?? 'support'}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-zinc-400">{suggestion.reason}</p>
                      {suggestion.evidence && suggestion.evidence.length > 0 && (
                        <p className="truncate text-[11px] text-zinc-500">
                          {suggestion.evidence.slice(0, 3).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                        disabled={busyId !== null}
                        onClick={() => void handleApply(suggestion._id)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Apply
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => beginEdit(suggestion)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => void handleIgnore(suggestion._id)}
                      >
                        Ignore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => void handleReject(suggestion._id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingSemantic !== undefined && visibleSemanticPending.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <ReviewSectionHeader
            title="Semantic function review"
            count={pendingSemantic.length}
            disabled={busyId !== null}
            onApply={() =>
              void runBulkAction('Apply semantic suggestions', pendingSemantic.length, () =>
                applyAllSemantic({ projectId }),
              )
            }
            onIgnore={() =>
              void runBulkAction('Ignore semantic suggestions', pendingSemantic.length, () =>
                ignoreAllSemantic({ projectId }),
              )
            }
            onReject={() =>
              void runBulkAction('Reject semantic suggestions', pendingSemantic.length, () =>
                rejectAllSemantic({ projectId }),
              )
            }
          />
          {visibleSemanticPending.map((suggestion) => {
            const isEditing = editingSemanticId === suggestion._id;
            return (
              <div
                key={suggestion._id}
                className="rounded-md border border-cyan-400/20 bg-cyan-400/5 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {suggestion.suggestedNodeName}
                    </p>
                    <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">
                      {suggestion.sourceFilePath}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-200">
                    {Math.round(suggestion.confidence * 100)}%
                  </span>
                </div>

                {isEditing ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={semanticDraft.suggestedNodeName}
                      onChange={(event) =>
                        setSemanticDraft((prev) => ({
                          ...prev,
                          suggestedNodeName: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    />
                    <select
                      value={semanticDraft.layerId}
                      onChange={(event) =>
                        setSemanticDraft((prev) => ({ ...prev, layerId: event.target.value }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    >
                      {(layers ?? []).map((layer) => (
                        <option key={layer._id} value={layer._id}>
                          {layer.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={semanticDraft.parentNodeId}
                      onChange={(event) =>
                        setSemanticDraft((prev) => ({
                          ...prev,
                          parentNodeId: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                    >
                      <option value="">No parent surface</option>
                      {(nodes ?? [])
                        .filter((node) => node.type === 'page')
                        .map((node) => (
                          <option key={node._id} value={node._id}>
                            {node.name}
                          </option>
                        ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={semanticDraft.semanticKind}
                        onChange={(event) =>
                          setSemanticDraft((prev) => ({
                            ...prev,
                            semanticKind: event.target.value as SemanticKind,
                          }))
                        }
                        className="h-8 rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {SEMANTIC_KIND_OPTIONS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                      <select
                        value={semanticDraft.productArea}
                        onChange={(event) =>
                          setSemanticDraft((prev) => ({
                            ...prev,
                            productArea: event.target.value as ProductArea,
                          }))
                        }
                        className="h-8 rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none"
                      >
                        {PRODUCT_AREA_OPTIONS.map((area) => (
                          <option key={area} value={area}>
                            {area}
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={semanticDraft.capabilityKey}
                      onChange={(event) =>
                        setSemanticDraft((prev) => ({ ...prev, capabilityKey: event.target.value }))
                      }
                      placeholder="Capability key"
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                    <input
                      value={semanticDraft.routeHint}
                      onChange={(event) =>
                        setSemanticDraft((prev) => ({ ...prev, routeHint: event.target.value }))
                      }
                      placeholder="Route hint"
                      className="h-8 w-full rounded border border-white/10 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none placeholder:text-zinc-600"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                        disabled={busyId !== null}
                        onClick={() => void saveSemanticEdit(suggestion._id)}
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07]"
                        onClick={() => setEditingSemanticId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mt-2 grid gap-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-cyan-200">
                          {suggestion.semanticKind.replace(/_/g, ' ')}
                        </span>
                        <span className="truncate text-zinc-500">
                          {suggestion.parentNodeName ??
                            suggestion.layerName ??
                            suggestion.productArea}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-zinc-500">
                          {suggestion.capabilityKey ??
                            suggestion.routeHint ??
                            suggestion.semanticKey}
                        </span>
                        <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-zinc-400">
                          {suggestion.productArea}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-zinc-400">{suggestion.reason}</p>
                      {suggestion.evidence && suggestion.evidence.length > 0 && (
                        <p className="truncate text-[11px] text-zinc-500">
                          {suggestion.evidence.slice(0, 3).join(' / ')}
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                        disabled={busyId !== null}
                        onClick={() => void handleSemanticApply(suggestion._id)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Apply
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => beginSemanticEdit(suggestion)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => void handleSemanticIgnore(suggestion._id)}
                      >
                        Ignore
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                        disabled={busyId !== null}
                        onClick={() => void handleSemanticReject(suggestion._id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {pendingRelationships !== undefined && visibleRelationshipPending.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <ReviewSectionHeader
            title="Relationship review"
            count={pendingRelationships.length}
            disabled={busyId !== null}
            onApply={() =>
              void runBulkAction(
                'Apply relationship suggestions',
                pendingRelationships.length,
                () => applyAllRelationships({ projectId }),
              )
            }
            onIgnore={() =>
              void runBulkAction(
                'Ignore relationship suggestions',
                pendingRelationships.length,
                () => ignoreAllRelationships({ projectId }),
              )
            }
            onReject={() =>
              void runBulkAction(
                'Reject relationship suggestions',
                pendingRelationships.length,
                () => rejectAllRelationships({ projectId }),
              )
            }
          />
          {visibleRelationshipPending.map((suggestion) => (
            <div
              key={suggestion._id}
              className="rounded-md border border-violet-400/20 bg-violet-400/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {suggestion.sourceNodeName ?? 'Source'} {'->'}{' '}
                    {suggestion.targetNodeName ?? 'Target'}
                  </p>
                  <p className="mt-1 text-xs text-violet-200">
                    {suggestion.type.replace(/_/g, ' ')}
                    {suggestion.label ? ` · ${suggestion.label}` : ''}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-zinc-400">{suggestion.reason}</p>
              {suggestion.evidence && suggestion.evidence.length > 0 && (
                <p className="mt-1 truncate text-[11px] text-zinc-500">
                  {suggestion.evidence.slice(0, 3).join(' · ')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                  disabled={busyId !== null}
                  onClick={() => void handleRelationshipApply(suggestion._id)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                  disabled={busyId !== null}
                  onClick={() => void handleRelationshipIgnore(suggestion._id)}
                >
                  Ignore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                  disabled={busyId !== null}
                  onClick={() => void handleRelationshipReject(suggestion._id)}
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingFlows !== undefined && visibleFlowPending.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <ReviewSectionHeader
            title="Flow review"
            count={pendingFlows.length}
            disabled={busyId !== null}
            onApply={() =>
              void runBulkAction('Apply flow suggestions', pendingFlows.length, () =>
                applyAllFlows({ projectId }),
              )
            }
            onIgnore={() =>
              void runBulkAction('Ignore flow suggestions', pendingFlows.length, () =>
                ignoreAllFlows({ projectId }),
              )
            }
            onReject={() =>
              void runBulkAction('Reject flow suggestions', pendingFlows.length, () =>
                rejectAllFlows({ projectId }),
              )
            }
          />
          {visibleFlowPending.map((flow) => (
            <div
              key={flow._id}
              className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {flow.shortTitle ?? flow.title}
                  </p>
                  <p className="mt-1 text-xs text-amber-200">
                    {flow.kind.replace(/_/g, ' ')} / {flow.steps.length} steps /{' '}
                    {flow.nodeIds.length} nodes
                  </p>
                  {flow.importance !== undefined && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      importance {Math.round(flow.importance * 100)}%
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                  {Math.round(flow.confidence * 100)}%
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-zinc-400">{flow.reason}</p>
              {flow.evidence && flow.evidence.length > 0 && (
                <p className="mt-1 truncate text-[11px] text-zinc-500">
                  {flow.evidence.slice(0, 3).join(' / ')}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                  disabled={busyId !== null}
                  onClick={() => void handleFlowApply(flow._id)}
                >
                  <Check className="h-3.5 w-3.5" />
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                  disabled={busyId !== null}
                  onClick={() => void handleFlowIgnore(flow._id)}
                >
                  Ignore
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 border border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.07] hover:text-zinc-50"
                  disabled={busyId !== null}
                  onClick={() => void handleFlowReject(flow._id)}
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(visibleApplied.length > 0 ||
        visibleIgnored.length > 0 ||
        visibleSemanticApplied.length > 0 ||
        visibleSemanticIgnored.length > 0 ||
        visibleRelationshipApplied.length > 0 ||
        visibleRelationshipIgnored.length > 0 ||
        visibleFlowApplied.length > 0 ||
        visibleFlowIgnored.length > 0) && (
        <div className="mt-3 border-t border-white/10 pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Auto-applied / ignored
          </p>
          <div className="space-y-1">
            {visibleApplied.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.suggestedNodeName}
                </span>
                <span className="shrink-0 text-[11px] text-emerald-300">applied</span>
              </div>
            ))}
            {visibleIgnored.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">{suggestion.filePath}</span>
                <span className="shrink-0 text-[11px] text-zinc-500">ignored</span>
              </div>
            ))}
            {visibleSemanticApplied.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.suggestedNodeName}
                </span>
                <span className="shrink-0 text-[11px] text-cyan-300">semantic</span>
              </div>
            ))}
            {visibleSemanticIgnored.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.suggestedNodeName}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">ignored semantic</span>
              </div>
            ))}
            {visibleRelationshipApplied.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.sourceNodeName ?? 'Source'} {'->'}{' '}
                  {suggestion.targetNodeName ?? 'Target'}
                </span>
                <span className="shrink-0 text-[11px] text-violet-300">edge</span>
              </div>
            ))}
            {visibleRelationshipIgnored.map((suggestion) => (
              <div
                key={suggestion._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="truncate text-xs text-zinc-300">
                  {suggestion.sourceNodeName ?? 'Source'} {'->'}{' '}
                  {suggestion.targetNodeName ?? 'Target'}
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">ignored edge</span>
              </div>
            ))}
            {visibleFlowApplied.map((flow) => (
              <div
                key={flow._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <GitBranch className="h-3 w-3 shrink-0 text-amber-300" />
                  <span className="truncate text-xs text-zinc-300">
                    {flow.shortTitle ?? flow.title}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-amber-300">flow</span>
              </div>
            ))}
            {visibleFlowIgnored.map((flow) => (
              <div
                key={flow._id}
                className="flex items-center justify-between gap-2 rounded-md bg-white/[0.03] px-2 py-1.5"
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <GitBranch className="h-3 w-3 shrink-0 text-zinc-500" />
                  <span className="truncate text-xs text-zinc-300">
                    {flow.shortTitle ?? flow.title}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-zinc-500">ignored flow</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ReviewSectionHeader({
  title,
  count,
  disabled,
  onApply,
  onIgnore,
  onReject,
}: {
  title: string;
  count: number;
  disabled: boolean;
  onApply: () => void;
  onIgnore: () => void;
  onReject: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {title} ({count})
      </p>
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 border border-emerald-400/25 bg-emerald-400/10 px-2 text-[11px] text-emerald-100 hover:bg-emerald-400/20"
          disabled={disabled || count === 0}
          onClick={onApply}
        >
          Apply all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 border border-white/10 bg-white/[0.03] px-2 text-[11px] text-zinc-300 hover:bg-white/[0.07]"
          disabled={disabled || count === 0}
          onClick={onIgnore}
        >
          Ignore all
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 border border-rose-400/20 bg-rose-400/10 px-2 text-[11px] text-rose-100 hover:bg-rose-400/20"
          disabled={disabled || count === 0}
          onClick={onReject}
        >
          Reject all
        </Button>
      </div>
    </div>
  );
}
