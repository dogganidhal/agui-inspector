import { loader } from 'fumadocs-core/source';
import { metaSchema, pageSchema } from 'fumadocs-core/source/schema';
import { applyMdxPreset } from 'fumadocs-mdx/config';
import { defineDocs } from 'fumadocs-mdx/macro';

const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: pageSchema,
    // Search indexes prose only. A component's text inside it is still prose; its JSX source (a card's link) is not.
    mdxOptions: applyMdxPreset({ remarkStructureOptions: { types: ['heading', 'paragraph', 'blockquote', 'tableCell'] } }),
  },
  meta: { schema: metaSchema },
});

export const source = loader({ baseUrl: '/docs', source: docs.toFumadocsSource() });
