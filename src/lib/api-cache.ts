import { useEffect, useRef, useState } from "react";

// Cache simples em memória (fora do React), compartilhado entre todos os
// componentes da mesma aba do navegador — sobrevive a trocar de seção do
// painel e voltar. Complementado por um segundo nível em sessionStorage
// (abaixo), que sobrevive a recarregar a página (F5) também - achado de
// bug real: o Mariano via a aba "Modelos" (e outras que usam esse hook)
// demorar de novo toda vez que entrava no CRM, porque só o cache em
// memória se perdia a cada F5/nova entrada.
const memoryCache = new Map<string, unknown>();
const STORAGE_PREFIX = "crm_cache_";

function readStorageCache<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeStorageCache(key: string, value: unknown) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // sessionStorage indisponível (modo privado, quota cheia) - sem
    // cache extra, sem problema, cai pro comportamento de sempre.
  }
}

/** Busca dados via `fetcher`, mas só na primeira vez — se a mesma `key` já
 * foi buscada antes nesta sessão do navegador (mesmo depois de um F5),
 * devolve o resultado em cache IMEDIATAMENTE (sem "Carregando..." nem
 * espera), e atualiza em segundo plano. Resolve a sensação de "sistema
 * pesado" ao trocar de aba e voltar, ou ao recarregar a página inteira,
 * pra uma tela já visitada — sem esse cache, cada troca (ou F5) refazia
 * a chamada do zero e mostrava o estado de carregamento de novo. */
export function useCachedFetch<T>(key: string, fetcher: () => Promise<T>) {
  const cached = (memoryCache.get(key) as T | undefined) ?? readStorageCache<T>(key);
  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  async function run() {
    try {
      const result = await fetcherRef.current();
      memoryCache.set(key, result);
      writeStorageCache(key, result);
      setData(result);
      setLoading(false);
      return result;
    } catch {
      setLoading(false);
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        memoryCache.set(key, result);
        writeStorageCache(key, result);
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /** Força buscar de novo, ignorando o cache — usar depois de uma ação que
   * muda os dados no servidor (criar, editar, remover). */
  async function refetch() {
    return run();
  }

  return { data, loading, setData, refetch };
}
