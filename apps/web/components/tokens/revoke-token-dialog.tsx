'use client';

import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  tokenId: Id<'apiTokens'>;
  tokenName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RevokeTokenDialog({ tokenId, tokenName, open, onOpenChange }: Props) {
  const revoke = useMutation(api.apiTokens.revoke);

  const onConfirm = async () => {
    await revoke({ id: tokenId });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke &quot;{tokenName}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            Any MCP client using this token will stop working immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Revoke
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
