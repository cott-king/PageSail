import { APP_VERSION, REPO_URL } from '../config';
import { useI18n } from '../i18n/I18nProvider';
import { ToolHeader } from './Layout';

const NOTICES_URL = `${import.meta.env.BASE_URL}licenses/THIRD_PARTY_NOTICES.txt`;

export function AboutPage() {
  const { t } = useI18n();
  return (
    <div className="page narrow prose">
      <ToolHeader title={t('about.title')} description={t('about.summary', { version: APP_VERSION })} />
      <h2>{t('about.licenseTitle')}</h2>
      <p>{t('about.licenseText')}</p>
      <p>{t('about.thirdPartyText')}</p>
      <ul>
        <li>pdf.js (pdfjs-dist) — Apache-2.0</li>
        <li>pdf-lib, @pdf-lib/fontkit — MIT</li>
        <li>Fabric.js — MIT</li>
        <li>React — MIT</li>
        <li>fflate — MIT</li>
        <li>Noto Sans, Noto Sans SC, Noto Sans JP — SIL Open Font License 1.1</li>
      </ul>
      <p>
        <a href={NOTICES_URL} target="_blank" rel="noopener">
          {t('about.noticesLink')}
        </a>
      </p>
      <h2>{t('about.sourceTitle')}</h2>
      <p>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          {REPO_URL}
        </a>
      </p>
      <h2>{t('about.roadmapTitle')}</h2>
      <p>{t('about.roadmapText')}</p>
      <ul>
        <li>{t('about.roadmap1')}</li>
        <li>{t('about.roadmap2')}</li>
        <li>{t('about.roadmap3')}</li>
        <li>{t('about.roadmap4')}</li>
        <li>{t('about.roadmap5')}</li>
      </ul>
    </div>
  );
}
