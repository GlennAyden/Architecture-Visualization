'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Id } from '../../../convex/_generated/dataModel';

type ProjectViewState = {
  initialized: boolean;
  collapsedNodeIds: string[];
  expandedFlowClusterKeys: string[];
};

interface CanvasViewState {
  projects: Record<string, ProjectViewState>;
  ensureProject: (projectId: Id<'projects'>, defaultCollapsedNodeIds: string[]) => void;
  collapseNode: (projectId: Id<'projects'>, nodeId: string) => void;
  expandNode: (projectId: Id<'projects'>, nodeId: string) => void;
  collapseMany: (projectId: Id<'projects'>, nodeIds: string[]) => void;
  expandAllNodes: (projectId: Id<'projects'>) => void;
  setFlowClusterExpanded: (
    projectId: Id<'projects'>,
    clusterKey: string,
    expanded: boolean,
  ) => void;
  expandAllFlowClusters: (projectId: Id<'projects'>, clusterKeys: string[]) => void;
  collapseAllFlowClusters: (projectId: Id<'projects'>) => void;
}

function getProjectState(state: CanvasViewState, projectId: Id<'projects'>): ProjectViewState {
  return (
    state.projects[projectId as string] ?? {
      initialized: false,
      collapsedNodeIds: [],
      expandedFlowClusterKeys: [],
    }
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

export const useCanvasViewStore = create<CanvasViewState>()(
  persist(
    (set) => ({
      projects: {},
      ensureProject: (projectId, defaultCollapsedNodeIds) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          if (current.initialized) return state;
          return {
            projects: {
              ...state.projects,
              [key]: {
                ...current,
                initialized: true,
                collapsedNodeIds: unique(defaultCollapsedNodeIds),
              },
            },
          };
        }),
      collapseNode: (projectId, nodeId) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: {
                ...current,
                collapsedNodeIds: unique([...current.collapsedNodeIds, nodeId]),
              },
            },
          };
        }),
      expandNode: (projectId, nodeId) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: {
                ...current,
                collapsedNodeIds: current.collapsedNodeIds.filter((id) => id !== nodeId),
              },
            },
          };
        }),
      collapseMany: (projectId, nodeIds) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: {
                ...current,
                initialized: true,
                collapsedNodeIds: unique([...current.collapsedNodeIds, ...nodeIds]),
              },
            },
          };
        }),
      expandAllNodes: (projectId) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: { ...current, initialized: true, collapsedNodeIds: [] },
            },
          };
        }),
      setFlowClusterExpanded: (projectId, clusterKey, expanded) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          const next = expanded
            ? unique([...current.expandedFlowClusterKeys, clusterKey])
            : current.expandedFlowClusterKeys.filter((item) => item !== clusterKey);
          return {
            projects: {
              ...state.projects,
              [key]: { ...current, expandedFlowClusterKeys: next },
            },
          };
        }),
      expandAllFlowClusters: (projectId, clusterKeys) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: { ...current, expandedFlowClusterKeys: unique(clusterKeys) },
            },
          };
        }),
      collapseAllFlowClusters: (projectId) =>
        set((state) => {
          const key = projectId as string;
          const current = getProjectState(state, projectId);
          return {
            projects: {
              ...state.projects,
              [key]: { ...current, expandedFlowClusterKeys: [] },
            },
          };
        }),
    }),
    {
      name: 'arch-viz-canvas-view-v1',
      partialize: (state) => ({ projects: state.projects }),
    },
  ),
);
