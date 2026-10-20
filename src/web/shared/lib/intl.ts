export function intlLocale(locale: string): string {
  return locale === 'es' ? 'es-ES' : 'en-US';
}

export function formatCount(value: number, locale: string): string {
  return Math.round(value).toLocaleString(intlLocale(locale));
}
