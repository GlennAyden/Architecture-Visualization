'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { Download } from 'lucide-react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';

interface Props {
  projectId: Id<'projects'>;
}

const ERROR_DISPLAY_MS = 5000;

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function downloadJson(filename: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function ExportProjectButton({ projectId }: Props) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guard against re-firing the download when the query result re-renders
  // (e.g. another field on the project changes during the export window).
  const downloadedRef = useRef(false);

  // Gated query: only runs while `exporting` is true. The cached result is
  // discarded between exports because the component unmounts the subscription
  // (`'skip'`) as soon as we toggle exporting off.
  const snapshot = useQuery(
    api.exports.exportProject,
    exporting ? { projectId } : 'skip',
  );

  useEffect(() => {
    if (!exporting || snapshot === undefined) return;
    if (downloadedRef.current) return;

    if (snapshot === null) {
      downloadedRef.current = true;
      setError('Cannot export — you do not have access to this project.');
      setExporting(false);
      return;
    }

    downloadedRef.current = true;
    const slug = snapshot.project.slug || 'project';
    downloadJson(`${slug}-${todayStamp()}.json`, snapshot);
    setExporting(false);
  }, [exporting, snapshot]);

  // Auto-dismiss the inline error after a few seconds.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(null), ERROR_DISPLAY_MS);
    return () => window.clearTimeout(t);
  }, [error]);

  const onClick = () => {
    if (exporting) return;
    downloadedRef.current = false;
    setError(null);
    setExporting(true);
  };

  return (
    <div className="flex items-center gap-2">
      {error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={exporting}
        aria-label="Export project as JSON"
      >
        <Download className="h-4 w-4" />
        {exporting ? 'Exporting…' : 'Export'}
      </Button>
    </div>
  );
}
