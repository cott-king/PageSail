import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type RouteId = 'home' | 'pdf-to-image' | 'image-to-pdf' | 'pdf-pages' | 'pdf-annotate' | 'image-editor' | 'privacy' | 'about' | 'not-found';

export const ROUTE_PATHS: Record<Exclude<RouteId, 'not-found'>, string> = {
  home: '',
  'pdf-to-image': 'pdf-to-image',
  'image-to-pdf': 'image-to-pdf',
  'pdf-pages': 'pdf-pages',
  'pdf-annotate': 'pdf-annotate',
  'image-editor': 'image-editor',
  privacy: 'privacy',
  about: 'about',
};

const BASE = import.meta.env.BASE_URL || '/';

export function hrefFor(route: Exclude<RouteId, 'not-found'>): string {
  return `${BASE}${ROUTE_PATHS[route]}`;
}

function resolve(pathname: string): RouteId {
  let rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  rel = rel.replace(/\/+$/, '');
  for (const [id, path] of Object.entries(ROUTE_PATHS)) {
    if (path === rel) return id as RouteId;
  }
  return 'not-found';
}

/** A leave guard returns a confirmation message when there is unsaved work. */
type LeaveGuard = () => string | null;

interface RouterValue {
  route: RouteId;
  navigate: (route: Exclude<RouteId, 'not-found'>) => void;
  setLeaveGuard: (guard: LeaveGuard | null) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<RouteId>(() => resolve(window.location.pathname));
  const guardRef = useRef<LeaveGuard | null>(null);
  const currentPath = useRef(window.location.pathname);

  const confirmLeave = useCallback((): boolean => {
    const message = guardRef.current?.();
    return !message || window.confirm(message);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (!confirmLeave()) {
        // Restore the URL of the page we stayed on.
        window.history.pushState(null, '', currentPath.current);
        return;
      }
      currentPath.current = window.location.pathname;
      setRoute(resolve(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [confirmLeave]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (guardRef.current?.()) {
        e.preventDefault();
        // Legacy browsers need returnValue to show the prompt.
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const navigate = useCallback(
    (to: Exclude<RouteId, 'not-found'>) => {
      const href = hrefFor(to);
      if (href === window.location.pathname) return;
      if (!confirmLeave()) return;
      guardRef.current = null;
      window.history.pushState(null, '', href);
      currentPath.current = href;
      setRoute(to);
      window.scrollTo(0, 0);
    },
    [confirmLeave],
  );

  const setLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    guardRef.current = guard;
  }, []);

  const value = useMemo(() => ({ route, navigate, setLeaveGuard }), [route, navigate, setLeaveGuard]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

/** Warns before leaving a workspace (in-app navigation, reload, tab close) while `dirty`. */
export function useLeaveGuard(dirty: boolean, message: string): void {
  const { setLeaveGuard } = useRouter();
  useEffect(() => {
    setLeaveGuard(dirty ? () => message : null);
    return () => setLeaveGuard(null);
  }, [dirty, message, setLeaveGuard]);
}

export function Link({
  to,
  className,
  children,
  ...rest
}: { to: Exclude<RouteId, 'not-found'>; className?: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { navigate } = useRouter();
  return (
    <a
      {...rest}
      href={hrefFor(to)}
      className={className}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
