/** URL da extensão na Chrome Web Store. Vazio = ainda não publicada (cai no ZIP). */
export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/crm-assinaturas-%E2%80%94-barbear/odogbkjlebodlbdhchpjmdfimcnploko";

export function hasChromeStore() {
  return CHROME_STORE_URL.trim().length > 0;
}

/** Pagina de vendas da barbearia (projeto IA-BARBER-ATENDIMENTO). E pra ca que os
 * botoes "voltar" das paginas de cadastro/instalacao devem levar, e nao pra "/"
 * deste site (que hoje e a pagina das clinicas, fora de uso por enquanto). */
// Atencao: a raiz (zayloia.com.br) redireciona pro LOGIN quando a pessoa nao esta
// logada; a pagina de vendas e a rota /planos.
export const BARBER_SALES_URL = "https://zayloia.com.br/planos";
