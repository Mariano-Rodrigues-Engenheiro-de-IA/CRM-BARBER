/** URL da extensão na Chrome Web Store. Vazio = ainda não publicada (cai no ZIP). */
export const CHROME_STORE_URL = "";

export function hasChromeStore() {
  return CHROME_STORE_URL.trim().length > 0;
}
