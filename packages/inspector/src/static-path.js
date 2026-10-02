import { fileURLToPath } from 'node:url';

/** Absolute path of the built static asset directory (index.html plus its scripts). */
export const staticAssetsPath = fileURLToPath(new URL('../dist', import.meta.url));
