import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const repoUrl = 'https://github.com/dogganidhal/agui-inspector';

// The brand mark is read from branding/ at build time, so the site never carries a copy that can drift.
const mark = readFileSync(path.join(process.cwd(), '..', 'branding', 'mark.svg'), 'utf8');

function Brand() {
  return (
    <>
      <span className="docs-mark" aria-hidden dangerouslySetInnerHTML={{ __html: mark }} />
      <span className="docs-brand">agui-inspector</span>
    </>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Brand />, url: '/docs' },
    githubUrl: repoUrl,
    links: [{ text: 'Demo', url: `${process.env.BASE_PATH}/`, external: true }],
  };
}
