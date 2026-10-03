import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/notebook';
import { baseOptions } from '@/lib/layout';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  const base = baseOptions();
  return (
    <DocsLayout tree={source.getPageTree()} {...base} nav={{ ...base.nav, mode: 'top' }}>
      {children}
    </DocsLayout>
  );
}
