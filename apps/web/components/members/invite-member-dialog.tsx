'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from 'convex/react';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const formSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  projectId: Id<'projects'>;
  projectName: string;
  disabled?: boolean;
}

export function InviteMemberDialog({ projectId, projectName, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const invite = useMutation(api.projectMembers.invite);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    try {
      await invite({ projectId, email: values.email });
      reset();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to send invite.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setSubmitError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" disabled={disabled}>
            Invite by email
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invite to {projectName}</DialogTitle>
            <DialogDescription>
              They must have signed in to Arch Viz at least once. Up to 3 members per project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              autoFocus
              placeholder="teammate@example.com"
              {...register('email')}
            />
            {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Inviting…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
