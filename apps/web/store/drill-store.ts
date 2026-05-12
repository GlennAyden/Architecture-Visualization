'use client';

import { create } from 'zustand';
import type { Id } from '../../../convex/_generated/dataModel';

interface DrillState {
  drillNodeId: Id<'nodes'> | null;
  // parentId -> child node ids. Populated by the canvas page from the latest
  // nodes snapshot so shape utils can decide drill-vs-modal without re-querying.
  childrenByParentId: Map<string, string[]>;
  drillIn: (nodeId: Id<'nodes'>) => void;
  drillUp: (toNodeId: Id<'nodes'> | null) => void;
  reset: () => void;
  setChildren: (map: Map<string, string[]>) => void;
  hasChildren: (nodeId: string) => boolean;
}

export const useDrillStore = create<DrillState>((set, get) => ({
  drillNodeId: null,
  childrenByParentId: new Map(),
  drillIn: (nodeId) => set({ drillNodeId: nodeId }),
  drillUp: (toNodeId) => set({ drillNodeId: toNodeId }),
  reset: () => set({ drillNodeId: null }),
  setChildren: (map) => set({ childrenByParentId: map }),
  hasChildren: (nodeId) => {
    const list = get().childrenByParentId.get(nodeId);
    return list !== undefined && list.length > 0;
  },
}));
