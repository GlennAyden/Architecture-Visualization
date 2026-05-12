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
  shareId: Id<'shareTokens'>;
  shareName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RevokeShareDialog({ shareId, shareName, open, onOpenChange }: Props) {
  const revoke = useMutation(api.shareTokens.revoke);

  const onConfirm = async () => {
    await revoke({ id: shareId });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke &quot;{shareName}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            Anyone using this share link will lose access immediately. This cannot be undone.
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
