'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getNextFeaturePosition, getNextNodePosition, sortLayers } from '@/lib/architecture-layers';

interface Props {
  projectId: Id<'projects'>;
  nodes: Doc<'nodes'>[] | undefined;
  layers: Doc<'projectLayers'>[] | undefined;
}

type NodeKind = 'page' | 'feature';

export function AddNodeButton({ projectId, nodes, layers }: Props) {
  const create = useMutation(api.nodes.create);
  const sortedLayers = useMemo(() => sortLayers(layers), [layers]);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NodeKind>('page');
  const [name, setName] = useState('');
  const [layerId, setLayerId] = useState<string>('');
  const [parentId, setParentId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pageNodes = useMemo(() => (nodes ?? []).filter((n) => n.type === 'page'), [nodes]);
  const parentOptions = useMemo(() => {
    return pageNodes.filter((node) => node.layerId === layerId);
  }, [layerId, pageNodes]);

  useEffect(() => {
    if (!open) return;
    setKind('page');
    setName('');
    setLayerId(sortedLayers[0]?._id ?? '');
    setParentId('');
    setError(null);
  }, [open, sortedLayers]);

  useEffect(() => {
    if (kind !== 'feature') return;
    if (parentOptions.some((node) => node._id === parentId)) return;
    setParentId(parentOptions[0]?._id ?? '');
  }, [kind, parentId, parentOptions]);

  const hasValidParent = kind !== 'feature' || parentOptions.some((node) => node._id === parentId);
  const canSubmit =
    sortedLayers.length > 0 && name.trim().length > 0 && layerId.length > 0 && hasValidParent;

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Node name is required');
      return;
    }
    if (!layerId) {
      setError('Pick a layer first');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (kind === 'feature') {
        const parent = parentOptions.find((node) => node._id === parentId);
        if (!parent) {
          setError('Create a page in this layer before adding a feature');
          return;
        }

        await create({
          projectId,
          type: 'feature',
          name: trimmed,
          layerId: layerId as Id<'projectLayers'>,
          parentId: parent._id,
          ...getNextFeaturePosition({ nodes: nodes ?? [], parent }),
        });
      } else {
        const position = getNextNodePosition({
          layers: sortedLayers,
          nodes: nodes ?? [],
          layerId,
        });

        await create({
          projectId,
          type: 'page',
          name: trimmed,
          layerId: layerId as Id<'projectLayers'>,
          ...position,
        });
      }

      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create node');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        disabled={!layers || sortedLayers.length === 0}
      >
        <Plus className="h-4 w-4" />
        Add Node
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dark border-white/10 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Add node</DialogTitle>
            <DialogDescription>
              Pick the architecture layer before the node is created.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="node-kind">Node type</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as NodeKind)}>
                <SelectTrigger id="node-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="page">Page / surface</SelectItem>
                  <SelectItem value="feature">Feature inside a page</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="node-layer">Layer</Label>
              <Select value={layerId} onValueChange={(value) => setLayerId(value ?? '')}>
                <SelectTrigger id="node-layer" className="w-full">
                  <SelectValue placeholder="Pick a layer" />
                </SelectTrigger>
                <SelectContent>
                  {sortedLayers.map((layer) => (
                    <SelectItem key={layer._id} value={layer._id}>
                      {layer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === 'feature' && (
              <div className="grid gap-2">
                <Label htmlFor="node-parent">Parent page</Label>
                <Select
                  value={parentId}
                  onValueChange={(value) => setParentId(value ?? '')}
                  disabled={parentOptions.length === 0}
                >
                  <SelectTrigger id="node-parent" className="w-full">
                    <SelectValue placeholder="Pick a parent page" />
                  </SelectTrigger>
                  <SelectContent>
                    {parentOptions.map((page) => (
                      <SelectItem key={page._id} value={page._id}>
                        {page.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {parentOptions.length === 0 && (
                  <p className="text-xs leading-5 text-zinc-500">
                    This layer has no page yet. Create a page in this layer before adding a feature.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="node-name">Name</Label>
              <Input
                id="node-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={kind === 'page' ? 'e.g. Dashboard' : 'e.g. Filters panel'}
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}>
              {submitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
