import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import Search from '@/components/search';
import './global.css';

// The favicon is branding/icon.svg itself, inlined at build time as the inspector's page does by hand.
const icon = readFileSync(path.join(process.cwd(), '..', 'branding', 'icon.svg'), 'utf8');

export const metadata: Metadata = {
  title: { template: '%s · agui-inspector', default: 'agui-inspector' },
  description: 'A developer tool for AG-UI servers: every request, every event, checked against the protocol.',
  icons: { icon: `data:image/svg+xml,${encodeURIComponent(icon)}` },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* data-theme drives the inspector's own tokens; the class drives Fumadocs' dark variants. */}
        <RootProvider search={{ SearchDialog: Search }} theme={{ attribute: ['class', 'data-theme'] }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
