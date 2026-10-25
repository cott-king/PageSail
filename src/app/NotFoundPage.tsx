import { useI18n } from '../i18n/I18nProvider';
import { Link } from './router';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="page narrow">
      <h1>{t('notFound.title')}</h1>
      <p>{t('notFound.text')}</p>
      <Link to="home" className="btn btn-primary">
        {t('nav.allTools')}
      </Link>
    </div>
  );
}
