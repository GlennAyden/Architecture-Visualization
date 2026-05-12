'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawToken: string;
  shareName: string;
}

export function ShareRevealDialog({ open, onOpenChange, rawToken, shareName }: Props) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const url = `${origin}/share/${rawToken}`;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Link2 className="h-4 w-4" />
          </div>
          <DialogTitle>Copy your share link now</DialogTitle>
          <DialogDescription>
            This is the only time the full URL for{' '}
            <span className="font-medium text-foreground">{shareName}</span> will be shown. Anyone
            with the link can view the canvas — share it carefully.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-stretch gap-2">
          <code className="flex-1 break-all rounded-lg border border-border/60 bg-muted/60 px-3 py-2.5 font-mono text-xs leading-relaxed">
            {url}
          </code>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={copy}
            aria-label="Copy share link"
            className="h-auto"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            I&apos;ve copied it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
