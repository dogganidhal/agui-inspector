import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import type { MDXComponents } from 'mdx/types';

type Img = { src: string; width: number; height: number };

// A screenshot in the reader's theme: the light and dark captures in docs/images, one shown at a time.
function Screenshot({ light, dark, alt }: { light: Img; dark: Img; alt: string }) {
  return (
    <span className="not-prose my-6 block overflow-hidden rounded-xl border">
      <img src={light.src} width={light.width} height={light.height} alt={alt} className="block h-auto w-full dark:hidden" />
      <img src={dark.src} width={dark.width} height={dark.height} alt={alt} className="hidden h-auto w-full dark:block" />
    </span>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Screenshot, Step, Steps, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
