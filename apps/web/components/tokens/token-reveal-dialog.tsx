'use client';

import { useState } from 'react';
import { Copy, Check, KeyRound } from 'lucide-react';

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
  tokenName: string;
}

export function TokenRevealDialog({ open, onOpenChange, rawToken, tokenName }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(rawToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-4 w-4" />
          </div>
          <DialogTitle>Copy your token now</DialogTitle>
          <DialogDescription>
            This is the only time the raw value for{' '}
            <span className="font-medium text-foreground">{tokenName}</span> will be shown. Store it
            in your MCP client config — if lost, you must revoke and create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-stretch gap-2">
          <code className="flex-1 break-all rounded-lg border border-border/60 bg-muted/60 px-3 py-2.5 font-mono text-xs leading-relaxed">
            {rawToken}
          </code>
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={copy}
            aria-label="Copy token"
            className="h-auto"
          >
            {copied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            I&apos;ve stored it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
