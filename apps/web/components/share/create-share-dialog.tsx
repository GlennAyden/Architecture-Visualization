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
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name must be 80 characters or fewer'),
  expiration: z.enum(['never', '7d', '30d', 'custom']),
  customDate: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  projectId: Id<'projects'>;
  projectName: string;
  onCreated: (rawToken: string, name: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function CreateShareDialog({ projectId, projectName, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const create = useMutation(api.shareTokens.create);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', expiration: 'never', customDate: '' },
  });

  const expiration = watch('expiration');

  const onSubmit = async (values: FormValues) => {
    setSubmitError(null);
    let expiresAt: number | undefined;
    if (values.expiration === '7d') expiresAt = Date.now() + 7 * DAY_MS;
    else if (values.expiration === '30d') expiresAt = Date.now() + 30 * DAY_MS;
    else if (values.expiration === 'custom') {
      if (!values.customDate) {
        setSubmitError('Pick a custom expiration date.');
        return;
      }
      const ms = new Date(values.customDate).getTime();
      if (Number.isNaN(ms)) {
        setSubmitError('That date is invalid.');
        return;
      }
      if (ms <= Date.now()) {
        setSubmitError('Custom date must be in the future.');
        return;
      }
      expiresAt = ms;
    }

    try {
      const { rawToken } = await create({ projectId, name: values.name, expiresAt });
      onCreated(rawToken, values.name);
      reset();
      setOpen(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create share link.');
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
          <Button size="sm" variant="outline">
            New share link
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New share link</DialogTitle>
            <DialogDescription>
              Anyone with this link can view{' '}
              <span className="font-medium text-foreground">{projectName}</span>. You will only see
              the URL once.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="share-name">Label</Label>
            <Input
              id="share-name"
              autoFocus
              placeholder="e.g. Client preview"
              {...register('name')}
            />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Expiration</Label>
            <div className="space-y-1.5 text-sm">
              <label className="flex items-center gap-2 font-normal">
                <input type="radio" value="never" {...register('expiration')} />
                <span>Never</span>
              </label>
              <label className="flex items-center gap-2 font-normal">
                <input type="radio" value="7d" {...register('expiration')} />
                <span>7 days</span>
              </label>
              <label className="flex items-center gap-2 font-normal">
                <input type="radio" value="30d" {...register('expiration')} />
                <span>30 days</span>
              </label>
              <label className="flex items-center gap-2 font-normal">
                <input type="radio" value="custom" {...register('expiration')} />
                <span>Custom</span>
              </label>
              {expiration === 'custom' && (
                <Input type="date" className="mt-1" {...register('customDate')} />
              )}
            </div>
          </div>

          {submitError && <p className="text-sm text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
