'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { nodeDescriptionSchema } from '@arch-viz/shared';
import { Textarea } from '@/components/ui/textarea';

const DEBOUNCE_MS = 500;

interface Props {
  nodeId: Id<'nodes'>;
  description: string;
}

export function DescriptionTab({ nodeId, description }: Props) {
  const update = useMutation(api.nodes.update);
  const [value, setValue] = useState(description);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(description);
  }, [description, nodeId]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);

    const parse = nodeDescriptionSchema.safeParse(next);
    if (!parse.success) {
      setError(parse.error.issues[0]?.message ?? 'Invalid description');
      return;
    }
    setError(null);

    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus('saving');
    timerRef.current = setTimeout(async () => {
      await update({ id: nodeId, description: next });
      setStatus('saved');
    }, DEBOUNCE_MS);
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <div className="space-y-2 py-2">
      <Textarea
        value={value}
        onChange={onChange}
        rows={8}
        placeholder="Describe what this page is for, what it does, and any notes…"
      />
      <div className="flex justify-between text-xs">
        <span className="text-destructive">{error}</span>
        <span className="text-muted-foreground">
          {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}
        </span>
      </div>
    </div>
  );
}
