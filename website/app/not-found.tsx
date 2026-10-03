// GitHub Pages serves this page for any missing path on the site, the demo's included.
import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout';

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
        <p className="font-mono text-xs text-fd-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold">Nothing at this address</h1>
        <p className="text-fd-muted-foreground">
          Try the{' '}
          <Link href="/docs" className="text-fd-foreground underline">
            documentation
          </Link>{' '}
          or the{' '}
          <a href={`${process.env.BASE_PATH}/`} className="text-fd-foreground underline">
            demo
          </a>
          .
        </p>
      </main>
    </HomeLayout>
  );
}
