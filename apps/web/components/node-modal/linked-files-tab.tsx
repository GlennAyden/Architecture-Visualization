'use client';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Trash2 } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  nodeId: Id<'nodes'>;
}

export function LinkedFilesTab({ nodeId }: Props) {
  const files = useQuery(api.nodeFiles.listByNode, { nodeId });
  const add = useMutation(api.nodeFiles.add);
  const remove = useMutation(api.nodeFiles.remove);

  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onAdd = async () => {
    const trimmed = path.trim();
    if (trimmed.length === 0) {
      setError('Enter a file path');
      return;
    }
    if (trimmed.length > 500) {
      setError('Path must be 500 characters or fewer');
      return;
    }
    setError(null);
    await add({ nodeId, path: trimmed });
    setPath('');
  };

  return (
    <div className="space-y-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="apps/web/app/login/page.tsx"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
          />
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        <Button onClick={onAdd}>Add</Button>
      </div>

      {files === undefined && <p className="text-muted-foreground text-sm">Loading…</p>}
      {files && files.length === 0 && (
        <p className="text-sm text-muted-foreground">No linked files yet.</p>
      )}
      {files && files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li
              key={f._id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm font-mono"
            >
              <span className="truncate">{f.path}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${f.path}`}
                onClick={() => remove({ id: f._id })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
