import { useI18n } from '../i18n/I18nProvider';
import type { MessageKey } from '../i18n/messages';
import { Icon, type IconName } from '../components/Icon';
import { Link, type RouteId } from './router';

interface ToolCard {
  route: Exclude<RouteId, 'not-found'>;
  icon: IconName;
  title: MessageKey;
  desc: MessageKey;
}

/** Only tools that are actually implemented are listed here. Future ideas live in docs/ROADMAP.md. */
const GROUPS: { title: MessageKey; tools: ToolCard[] }[] = [
  {
    title: 'home.groupConvert',
    tools: [
      { route: 'pdf-to-image', icon: 'image', title: 'tool.pdfToImage.title', desc: 'tool.pdfToImage.short' },
      { route: 'image-to-pdf', icon: 'file', title: 'tool.imageToPdf.title', desc: 'tool.imageToPdf.short' },
    ],
  },
  {
    title: 'home.groupOrganize',
    tools: [{ route: 'pdf-pages', icon: 'pages', title: 'tool.pdfPages.title', desc: 'tool.pdfPages.short' }],
  },
  {
    title: 'home.groupEdit',
    tools: [
      { route: 'pdf-annotate', icon: 'edit', title: 'tool.pdfAnnotate.title', desc: 'tool.pdfAnnotate.short' },
      { route: 'image-editor', icon: 'crop', title: 'tool.imageEditor.title', desc: 'tool.imageEditor.short' },
    ],
  },
];

export function HomePage() {
  const { t } = useI18n();
  return (
    <div className="page home">
      <section className="hero">
        <h1>{t('home.title')}</h1>
        <p className="hero-tagline">{t('home.tagline')}</p>
        <p className="hero-intro">{t('home.intro')}</p>
        <ul className="hero-points">
          <li>
            <Icon name="shield" size={18} />
            {t('home.pointLocal')}
          </li>
          <li>
            <Icon name="check" size={18} />
            {t('home.pointNoAccount')}
          </li>
          <li>
            <Icon name="code" size={18} />
            {t('home.pointOpenSource')}
          </li>
        </ul>
      </section>
      {GROUPS.map((g) => (
        <section key={g.title} className="tool-group" aria-labelledby={`group-${g.title}`}>
          <h2 id={`group-${g.title}`}>{t(g.title)}</h2>
          <div className="tool-grid">
            {g.tools.map((tool) => (
              <Link key={tool.route} to={tool.route} className="tool-card" data-testid={`tool-${tool.route}`}>
                <span className="tool-card-icon">
                  <Icon name={tool.icon} size={26} />
                </span>
                <span className="tool-card-text">
                  <strong>{t(tool.title)}</strong>
                  <span>{t(tool.desc)}</span>
                </span>
                <Icon name="chevronRight" size={18} className="tool-card-go" />
              </Link>
            ))}
          </div>
        </section>
      ))}
      <section className="home-note">
        <p>
          {t('home.limitsNote')} <Link to="privacy">{t('home.limitsLink')}</Link>
        </p>
      </section>
    </div>
  );
}
