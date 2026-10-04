// The top bar's mark and name (spec 003). Without a brand it is the agui-inspector mark and name. A brand from
// `config.json` replaces each part it sets: its name is the heading, its logo an unframed image. The images are
// decoration (`alt=""`): the heading names the page. A dark logo is a second image that the stylesheet shows in the
// dark theme, so the theme switch and the system preference reach it the way they reach the tokens.
import type { ReactElement } from 'react';
import type { BrandConfig } from '../contracts';
import { Icon } from '../views/theme/index';

export type LogoField = 'logo' | 'logoDark';

const Mark = (): ReactElement => (
  <span className="agui-app-mark" aria-hidden="true">
    <Icon name="mark" size={16} />
  </span>
);

/** `failed` holds the logos whose image did not load; each shows the default mark instead. */
export function Brand({ brand, failed, onFailed }: { brand: BrandConfig | undefined; failed: readonly LogoField[]; onFailed: (field: LogoField) => void }): ReactElement {
  const logo = (field: LogoField, src: string) => (failed.includes(field) ? <Mark /> : <img className="agui-app-logo-img" src={src} alt="" onError={() => onFailed(field)} />);
  return (
    <span className="agui-app-brand">
      {brand?.logo === undefined ? (
        <Mark />
      ) : (
        <span className="agui-app-logo" aria-hidden="true">
          {brand.logoDark === undefined ? (
            logo('logo', brand.logo)
          ) : (
            <>
              <span data-for="light">{logo('logo', brand.logo)}</span>
              <span data-for="dark">{logo('logoDark', brand.logoDark)}</span>
            </>
          )}
        </span>
      )}
      <h1>{brand?.name ?? 'agui-inspector'}</h1>
    </span>
  );
}
