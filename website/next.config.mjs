// The docs site is a static export. GitHub Pages serves it beside the public demo, so the base path is
// the one the Pages workflow reads from the site settings; locally it is the project path the demo uses.
// The demo owns the site root: this app has no page at "/", so the two outputs never share a file.
import path from 'node:path';
import { createMDX } from 'fumadocs-mdx/next';

const basePath = process.env.PAGES_BASE_PATH ?? '/agui-inspector';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  trailingSlash: true,
  reactStrictMode: true,
  env: { BASE_PATH: basePath },
  // The repository, because the theme imports the inspector's own tokens.css from packages/.
  turbopack: { root: path.resolve(import.meta.dirname, '..') },
};

export default createMDX()(config);
