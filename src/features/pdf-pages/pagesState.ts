import { normalizeRotation } from '../../lib/pdf/coords';

/** Pure state for the page organizer. Pages are references; PDF bytes are never copied here. */
export interface PageRef {
  key: string;
  sourceId: string;
  pageIndex: number;
  /** Clockwise rotation added by the visitor (0/90/180/270). */
  rotation: number;
}

export interface PagesState {
  pages: PageRef[];
  /** Pages exactly as added (file order, no rotation): the "unchanged" reference. */
  pristine: PageRef[];
  selected: string[];
  past: PageRef[][];
  future: PageRef[][];
}

export type PagesAction =
  | { type: 'add'; pages: PageRef[] }
  | { type: 'rotate'; keys: string[]; delta: number }
  | { type: 'remove'; keys: string[] }
  | { type: 'moveSelected'; delta: -1 | 1 }
  | { type: 'moveTo'; key: string; toKey: string }
  | { type: 'toggle'; key: string }
  | { type: 'selectRange'; fromKey: string; toKey: string }
  | { type: 'selectAll' }
  | { type: 'selectNone' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' };

export const initialPagesState: PagesState = { pages: [], pristine: [], selected: [], past: [], future: [] };

/** True when the page list differs from simply concatenating the added files. */
export function isModified(state: PagesState): boolean {
  if (state.pages.length !== state.pristine.length) return true;
  return state.pages.some((p, i) => p.key !== state.pristine[i].key || p.rotation !== 0);
}

const HISTORY = 100;

function commit(state: PagesState, pages: PageRef[], selected = state.selected): PagesState {
  const keys = new Set(pages.map((p) => p.key));
  return {
    ...state,
    pages,
    selected: selected.filter((k) => keys.has(k)),
    past: [...state.past, state.pages].slice(-HISTORY),
    future: [],
  };
}

export function pagesReducer(state: PagesState, action: PagesAction): PagesState {
  switch (action.type) {
    case 'add':
      // Adding files is not an edit: extend every history snapshot so undo never drops them.
      return {
        ...state,
        pages: [...state.pages, ...action.pages],
        pristine: [...state.pristine, ...action.pages],
        past: state.past.map((s) => [...s, ...action.pages]),
        future: state.future.map((s) => [...s, ...action.pages]),
      };
    case 'rotate': {
      const keys = new Set(action.keys);
      if (keys.size === 0) return state;
      return commit(
        state,
        state.pages.map((p) => (keys.has(p.key) ? { ...p, rotation: normalizeRotation(p.rotation + action.delta) } : p)),
      );
    }
    case 'remove': {
      const keys = new Set(action.keys);
      if (keys.size === 0) return state;
      return commit(
        state,
        state.pages.filter((p) => !keys.has(p.key)),
        state.selected.filter((k) => !keys.has(k)),
      );
    }
    case 'moveSelected': {
      const sel = new Set(state.selected);
      if (sel.size === 0) return state;
      const pages = [...state.pages];
      if (action.delta < 0) {
        for (let i = 1; i < pages.length; i++) {
          if (sel.has(pages[i].key) && !sel.has(pages[i - 1].key)) [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]];
        }
      } else {
        for (let i = pages.length - 2; i >= 0; i--) {
          if (sel.has(pages[i].key) && !sel.has(pages[i + 1].key)) [pages[i + 1], pages[i]] = [pages[i], pages[i + 1]];
        }
      }
      if (pages.every((p, i) => p === state.pages[i])) return state;
      return commit(state, pages);
    }
    case 'moveTo': {
      const from = state.pages.findIndex((p) => p.key === action.key);
      const to = state.pages.findIndex((p) => p.key === action.toKey);
      if (from < 0 || to < 0 || from === to) return state;
      const pages = [...state.pages];
      const [p] = pages.splice(from, 1);
      pages.splice(to, 0, p);
      return commit(state, pages);
    }
    case 'toggle':
      return {
        ...state,
        selected: state.selected.includes(action.key) ? state.selected.filter((k) => k !== action.key) : [...state.selected, action.key],
      };
    case 'selectRange': {
      const a = state.pages.findIndex((p) => p.key === action.fromKey);
      const b = state.pages.findIndex((p) => p.key === action.toKey);
      if (a < 0 || b < 0) return state;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = state.pages.slice(lo, hi + 1).map((p) => p.key);
      return { ...state, selected: [...new Set([...state.selected, ...range])] };
    }
    case 'selectAll':
      return { ...state, selected: state.pages.map((p) => p.key) };
    case 'selectNone':
      return { ...state, selected: [] };
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      const keys = new Set(prev.map((p) => p.key));
      return { ...state, pages: prev, selected: state.selected.filter((k) => keys.has(k)), past: state.past.slice(0, -1), future: [state.pages, ...state.future] };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      const keys = new Set(next.map((p) => p.key));
      return { ...state, pages: next, selected: state.selected.filter((k) => keys.has(k)), past: [...state.past, state.pages], future: rest };
    }
    case 'clear':
      return initialPagesState;
  }
}

/** Splits an ordered page list into chunks of `n`. */
export function chunk<T>(list: T[], n: number): T[][] {
  const size = Math.max(1, Math.floor(n));
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
