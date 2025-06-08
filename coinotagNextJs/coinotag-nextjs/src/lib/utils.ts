export function formatDate(date: Date | string | number, locale?: string, options?: Intl.DateTimeFormatOptions) {
  let finalLocale = 'tr-TR'; // Varsayılan
  if (locale && typeof locale === 'string') {
    if (!locale.includes('-')) {
        finalLocale = locale.toLowerCase() === 'en' ? 'en-US' : 'tr-TR'; // Sadece en ve tr için basit örnek, diğerleri tr-TR
    } else {
        // Geçerli bir locale olup olmadığını kontrol etmek daha iyi olurdu (örn: ['en-US', 'tr-TR'].includes(locale))
        // Şimdilik gelen değeri kullanıyoruz, ama güvenlik açığı olabilir.
        finalLocale = locale;
    }
  }

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  const finalOptions = { ...defaultOptions, ...options };
  
  try {
    return new Intl.DateTimeFormat(finalLocale, finalOptions).format(new Date(date));
  } catch (e) {
    console.error(`Error formatting date with locale ${finalLocale}. Falling back to tr-TR. Error:`, e);
    return new Intl.DateTimeFormat('tr-TR', finalOptions).format(new Date(date));
  }
} 