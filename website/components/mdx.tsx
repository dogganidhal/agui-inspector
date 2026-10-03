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

// A recording in the reader's theme, like Screenshot. The files are in website/public/docs, served under the base path.
// Controls, so a reader can pause the loop.
function Video({ light, dark, label }: { light: string; dark: string; label: string }) {
  const src = (file: string) => `${process.env.BASE_PATH}/docs/${file}`;
  return (
    <span className="not-prose my-6 block overflow-hidden rounded-xl border">
      <video src={src(light)} width={2400} height={1560} aria-label={label} autoPlay muted loop playsInline controls className="block h-auto w-full dark:hidden" />
      <video src={src(dark)} width={2400} height={1560} aria-label={label} autoPlay muted loop playsInline controls className="hidden h-auto w-full dark:block" />
    </span>
  );
}

export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Screenshot, Step, Steps, Video, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
