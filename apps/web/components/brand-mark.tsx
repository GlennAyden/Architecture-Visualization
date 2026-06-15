import Link from 'next/link';
import { Network } from 'lucide-react';

import { cn } from '@/lib/utils';

interface Props {
  href?: string;
  className?: string;
}

/**
 * Small wordmark + icon used in page headers.
 * Pass `href` to make it a link (e.g. back to /projects).
 */
export function BrandMark({ href, className }: Props) {
  const content = (
    <span
      className={cn('inline-flex items-center gap-2 text-sm font-medium tracking-tight', className)}
    >
      <span
        aria-hidden
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"
      >
        <Network className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
      <span>Arch&nbsp;Viz</span>
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="text-foreground hover:opacity-80 transition-opacity">
        {content}
      </Link>
    );
  }
  return content;
}
