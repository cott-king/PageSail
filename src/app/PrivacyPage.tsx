import { LIMITS, BYTES_PER_MB, PIXELS_PER_MEGAPIXEL } from '../config';
import { useI18n } from '../i18n/I18nProvider';
import { ToolHeader } from './Layout';

export function PrivacyPage() {
  const { t } = useI18n();
  const rows: [string, string][] = [
    [t('privacy.limitPdf'), `${Math.round(LIMITS.maxPdfBytes / BYTES_PER_MB)} MB`],
    [t('privacy.limitImage'), `${Math.round(LIMITS.maxImageBytes / BYTES_PER_MB)} MB`],
    [t('privacy.limitPixels'), `${Math.round(LIMITS.maxImagePixels / PIXELS_PER_MEGAPIXEL)} MP`],
    [t('privacy.limitRender'), `${Math.round(LIMITS.maxRenderPixels / PIXELS_PER_MEGAPIXEL)} MP`],
    [t('privacy.limitFiles'), String(LIMITS.maxFiles)],
    [t('privacy.limitHistory'), String(LIMITS.historySteps)],
  ];
  return (
    <div className="page narrow prose">
      <ToolHeader title={t('privacy.title')} description={t('privacy.summary')} />
      <h2>{t('privacy.processingTitle')}</h2>
      <ul>
        <li>{t('privacy.p1')}</li>
        <li>{t('privacy.p2')}</li>
        <li>{t('privacy.p3')}</li>
        <li>{t('privacy.p4')}</li>
        <li>{t('privacy.p5')}</li>
      </ul>
      <h2>{t('privacy.resourcesTitle')}</h2>
      <p>{t('privacy.resourcesText')}</p>
      <h2>{t('privacy.hostTitle')}</h2>
      <p>{t('privacy.hostText')}</p>
      <h2>{t('privacy.limitsTitle')}</h2>
      <p>{t('privacy.limitsText')}</p>
      <table className="limits-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">{t('privacy.limitsConfig')}</p>
    </div>
  );
}
