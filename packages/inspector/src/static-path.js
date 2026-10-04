import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Not `new URL('../dist', import.meta.url)`: a bundler (Turbopack in a Next.js route handler) reads that form as an
// asset import and fails on the directory.
/** Absolute path of the built static asset directory (index.html plus its scripts). */
export const staticAssetsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
