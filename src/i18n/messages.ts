import { en } from './locales/en';
import { ja } from './locales/ja';
import { zhCN } from './locales/zh-CN';

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
export type Locale = 'zh-CN' | 'en' | 'ja';

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
];

export const messages: Record<Locale, Messages> = {
  'zh-CN': zhCN,
  en,
  ja,
};
