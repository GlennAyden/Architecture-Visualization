'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from 'convex/react';

import { nodeNameSchema } from '@arch-viz/shared';
import { api } from '../../../../convex/_generated/api';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const formSchema = z.object({
  parentId: z.string().min(1, 'Pick a parent page'),
  name: nodeNameSchema,
});
type FormValues = z.infer<typeof formSchema>;

interface Props {
  projectId: Id<'projects'>;
  pageNodes: Doc<'nodes'>[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddFeatureDialog({ projectId, pageNodes, open, onOpenChange }: Props) {
  const create = useMutation(api.nodes.create);

  const defaultParentId = pageNodes[0]?._id ?? '';

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { parentId: defaultParentId, name: '' },
  });

  // Reset the form whenever the dialog opens so the parent select reflects the
  // latest pageNodes list (a page may have been added since the last open).
  useEffect(() => {
    if (open) {
      reset({ parentId: pageNodes[0]?._id ?? '', name: '' });
    }
  }, [open, pageNodes, reset]);

  const onSubmit = async (values: FormValues) => {
    const parent = pageNodes.find((n) => n._id === values.parentId);
    if (!parent) return;
    await create({
      projectId,
      type: 'feature',
      name: values.name,
      parentId: parent._id,
      positionX: Math.round(parent.positionX + 60),
      positionY: Math.round(parent.positionY + 60),
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add a feature</DialogTitle>
            <DialogDescription>
              Features live under a page. Pick the parent page and give your feature a name.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="parent">Parent page</Label>
            <Controller
              control={control}
              name="parentId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="parent" className="w-full">
                    <SelectValue placeholder="Pick a parent page" />
                  </SelectTrigger>
                  <SelectContent>
                    {pageNodes.map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.parentId && (
              <p className="text-sm text-destructive">{errors.parentId.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Feature name</Label>
            <Input id="name" autoFocus placeholder="e.g. Login form" {...register('name')} />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
