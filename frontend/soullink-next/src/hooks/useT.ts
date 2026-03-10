/**
 * React hook for i18n translations.
 * Returns a `t(key, vars?)` function bound to the current language from Redux.
 */

import { useMemo } from 'react';
import { useAppSelector } from '@/store';
import { createT } from '@/lib/i18n';

export function useT() {
  const language = useAppSelector((s) => s.settings.language);
  return useMemo(() => createT(language), [language]);
}
