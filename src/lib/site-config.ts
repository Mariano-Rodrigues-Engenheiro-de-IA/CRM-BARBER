/** URL da extensão na Chrome Web Store. Vazio = ainda não publicada (cai no ZIP). */
export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/crm-assinaturas-%E2%80%94-barbear/odogbkjlebodlbdhchpjmdfimcnploko";

export function hasChromeStore() {
  return CHROME_STORE_URL.trim().length > 0;
}
