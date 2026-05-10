'use client';

import { create } from 'zustand';
import type { Id } from '../../../convex/_generated/dataModel';

interface ModalState {
  selectedNodeId: Id<'nodes'> | null;
  open: (nodeId: Id<'nodes'>) => void;
  close: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  selectedNodeId: null,
  open: (nodeId) => set({ selectedNodeId: nodeId }),
  close: () => set({ selectedNodeId: null }),
}));
