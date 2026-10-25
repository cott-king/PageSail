import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { LOCALES, type Locale } from '../i18n/messages';
import { APP_VERSION, REPO_URL } from '../config';
import { Icon } from '../components/Icon';
import { Link } from './router';

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)" />
      <path d="M16 6v15l-8-2z" fill="#fff" />
      <path d="M17.5 9l7 10.5-7 1.5z" fill="#fff" opacity="0.8" />
      <path d="M6 23h20l-3 3.5H9z" fill="#fff" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('nav.skipToContent')}
      </a>
      <header className="app-header">
        <Link to="home" className="brand" aria-label={t('nav.home')}>
          <Logo />
          <span>PageSail</span>
        </Link>
        <nav className="header-nav" aria-label={t('nav.main')}>
          <Link to="privacy">{t('nav.privacy')}</Link>
          <Link to="about">{t('nav.about')}</Link>
        </nav>
        <label className="lang-select">
          <Icon name="globe" size={18} />
          <span className="visually-hidden">{t('nav.language')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('nav.language')}>
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-footer">
        <p>{t('footer.localProcessing')}</p>
        <nav aria-label={t('nav.footer')}>
          <Link to="privacy">{t('nav.privacy')}</Link>
          <Link to="about">{t('nav.aboutLicenses')}</Link>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            {t('footer.source')}
          </a>
          <span className="muted">v{APP_VERSION}</span>
        </nav>
      </footer>
    </div>
  );
}

/** Common header for every tool page. */
export function ToolHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="tool-header">
      <div>
        <Link to="home" className="back-link">
          <Icon name="chevronLeft" size={16} />
          {t('nav.allTools')}
        </Link>
        <h1>{title}</h1>
        <p className="tool-desc">{description}</p>
      </div>
      {actions && <div className="tool-header-actions">{actions}</div>}
    </div>
  );
}
