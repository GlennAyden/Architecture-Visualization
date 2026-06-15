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
  memberId: Id<'projectMembers'>;
  memberEmail: string;
  accepted: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RevokeMemberDialog({ memberId, memberEmail, accepted, open, onOpenChange }: Props) {
  const revoke = useMutation(api.projectMembers.revoke);

  const onConfirm = async () => {
    await revoke({ id: memberId });
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {accepted ? `Remove ${memberEmail}?` : `Revoke invite to ${memberEmail}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {accepted
              ? 'They will lose access to this project immediately. You can re-invite them later.'
              : 'The pending invite will disappear from their inbox. You can re-invite them later.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {accepted ? 'Remove' : 'Revoke'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
