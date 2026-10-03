// The search index, written once at build time and searched in the browser. No search service is involved.
import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, { language: 'english' });
