import { useEffect, useRef, useState } from "react";

// Cache simples em memória (fora do React), compartilhado entre todos os
// componentes da mesma aba do navegador — sobrevive a trocar de seção do
// painel e voltar, mas se perde ao recarregar a página (F5), que é o
// comportamento certo pra dados que podem mudar no servidor.
const memoryCache = new Map<string, unknown>();

/** Busca dados via `fetcher`, mas só na primeira vez — se a mesma `key` já
 * foi buscada antes nesta sessão, devolve o resultado em cache
 * IMEDIATAMENTE (sem "Carregando..." nem espera), e atualiza em segundo
 * plano. Resolve a sensação de "sistema pesado" ao trocar de aba e voltar
 * pra uma tela já visitada — sem esse cache, cada troca de aba refazia a
 * chamada do zero e mostrava o estado de carregamento de novo. */
export function useCachedFetch<T>(key: string, fetcher: () => Promise<T>) {
  const cached = memoryCache.get(key) as T | undefined;
  const [data, setData] = useState<T | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  async function run() {
    try {
      const result = await fetcherRef.current();
      memoryCache.set(key, result);
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
