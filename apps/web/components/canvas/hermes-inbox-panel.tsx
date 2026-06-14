'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Bot, Check, Pencil, Play, RotateCw, ShieldCheck, X } from 'lucide-react';

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
type ReviewDraft = {
  action: SuggestionAction;
  layerId: string;
  targetNodeId: string;
  groupKey: string;
  suggestedNodeName: string;
  semanticKind: SemanticKind | '';
  fileRole: FileRole | '';
};

function isHighConfidence(action: SuggestionAction, confidence: number) {
  return action === 'link_existing_node' || action === 'ignore'
    ? confidence >= 0.9
    : confidence >= 0.85;
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
  const runs = useQuery(api.hermesMappingRuns.latestByProject, { projectId });
  const layers = useQuery(api.projectLayers.listByProject, { projectId });
  const nodes = useQuery(api.nodes.listByProject, { projectId });
  const apply = useMutation(api.codebaseSuggestions.apply);
  const reject = useMutation(api.codebaseSuggestions.reject);
  const ignore = useMutation(api.codebaseSuggestions.ignore);
  const updateReview = useMutation(api.codebaseSuggestions.updateReview);
  const bulkApply = useMutation(api.codebaseSuggestions.applyHighConfidence);
  const applyRelationship = useMutation(api.relationshipSuggestions.apply);
  const rejectRelationship = useMutation(api.relationshipSuggestions.reject);
  const ignoreRelationship = useMutation(api.relationshipSuggestions.ignore);
  const bulkApplyRelationships = useMutation(api.relationshipSuggestions.applyHighConfidence);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id<'codebaseSuggestions'> | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>({
    action: 'create_node',
    layerId: '',
    targetNodeId: '',
    groupKey: '',
    suggestedNodeName: '',
    semanticKind: '',
    fileRole: '',
  });

  const visiblePending = pending?.slice(0, 5) ?? [];
  const visibleRelationshipPending = pendingRelationships?.slice(0, 4) ?? [];
  const visibleApplied = applied?.slice(0, 3) ?? [];
  const visibleIgnored = ignored?.slice(0, 3) ?? [];
  const visibleRelationshipApplied = appliedRelationships?.slice(0, 2) ?? [];
  const visibleRelationshipIgnored = ignoredRelationships?.slice(0, 2) ?? [];
  const latestRun = runs?.[0];
  const highConfidenceCount = useMemo(
    () =>
      (pending ?? []).filter((suggestion) =>
        isHighConfidence(suggestion.action as SuggestionAction, suggestion.confidence),
      ).length +
      (pendingRelationships ?? []).filter((suggestion) => suggestion.confidence >= 0.9).length,
    [pending, pendingRelationships],
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

  const handleBulkApply = async () => {
    setBusyId('bulk');
    try {
      await bulkApply({ projectId });
      await bulkApplyRelationships({ projectId });
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Needs review
          </p>
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

      {pendingRelationships !== undefined && visibleRelationshipPending.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Relationship review
          </p>
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

      {(visibleApplied.length > 0 ||
        visibleIgnored.length > 0 ||
        visibleRelationshipApplied.length > 0 ||
        visibleRelationshipIgnored.length > 0) && (
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
          </div>
        </div>
      )}
    </section>
  );
}
