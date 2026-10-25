import { lazy, Suspense } from 'react';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';
import { RouterProvider, useRouter, type RouteId } from './router';
import { Layout } from './Layout';
import { HomePage } from './HomePage';
import { PrivacyPage } from './PrivacyPage';
import { AboutPage } from './AboutPage';
import { NotFoundPage } from './NotFoundPage';
import { ErrorBoundary } from './ErrorBoundary';

// Each tool is loaded on demand so the home page stays small.
const PdfToImagePage = lazy(() => import('../features/pdf-to-image/PdfToImagePage'));
const ImageToPdfPage = lazy(() => import('../features/image-to-pdf/ImageToPdfPage'));
const PdfPagesPage = lazy(() => import('../features/pdf-pages/PdfPagesPage'));
const PdfAnnotatePage = lazy(() => import('../features/pdf-annotate/PdfAnnotatePage'));
const ImageEditorPage = lazy(() => import('../features/image-editor/ImageEditorPage'));

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case 'home':
      return <HomePage />;
    case 'pdf-to-image':
      return <PdfToImagePage />;
    case 'image-to-pdf':
      return <ImageToPdfPage />;
    case 'pdf-pages':
      return <PdfPagesPage />;
    case 'pdf-annotate':
      return <PdfAnnotatePage />;
    case 'image-editor':
      return <ImageEditorPage />;
    case 'privacy':
      return <PrivacyPage />;
    case 'about':
      return <AboutPage />;
    default:
      return <NotFoundPage />;
  }
}

function Routes() {
  const { route } = useRouter();
  const { t } = useI18n();
  return (
    <Layout>
      <ErrorBoundary key={route}>
        <Suspense
          fallback={
            <div className="page-loading" role="status">
              {t('common.loadingTool')}
            </div>
          }
        >
          <Page route={route} />
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

export function App() {
  return (
    <I18nProvider>
      <RouterProvider>
        <Routes />
      </RouterProvider>
    </I18nProvider>
  );
}
