// Cliente de login SO do painel do CRM (portao de e-mail + senha).
//
// Diferente do cliente padrao do app, a sessao aqui fica em sessionStorage e
// com chave propria: vive so enquanto a ABA esta aberta. Fechou a aba, abriu
// de novo, pede a senha de novo (pedido do Mariano). Tambem nao se mistura
// com outros logins do sistema (ex: admin), que usam o cliente padrao.

import { createClient } from "@supabase/supabase-js";

function isNewApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

// Mesma adaptacao do cliente gerado: as chaves novas do Supabase sao strings
// opacas, nao JWTs, entao o Authorization igual a chave precisa sair.
function panelFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, k) => headers.set(k, value));
    }
    if (isNewApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

let _client: ReturnType<typeof createClient> | undefined;

/** Auth do painel. Criado sob demanda, so no navegador. */
export function getPanelAuth() {
  if (!_client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    _client = createClient(url, key, {
      global: { fetch: panelFetch(key) },
      auth: {
        storage: window.sessionStorage,
        storageKey: "crm-panel-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return _client.auth;
}
