// Cache compartilhado do endpoint /api/public/extension/wa/data (etiquetas +
// contatos do WhatsApp - até 3000 registros, busca pesada). Achado real na
// varredura de performance do Mariano: a aba de Funis chamava esse endpoint
// até 3 vezes em sequência só pra abrir a tela, e a aba de Disparo chamava
// de novo do zero toda vez que abria, sem cache nenhum. Agora as duas telas
// usam esse mesmo cache - só busca de novo se passou WA_DATA_STALE_MS desde
// a última vez, e telas diferentes reaproveitam o resultado uma da outra.

import type { WaLabel, WaContact } from "@/lib/funnels";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

const WA_DATA_STALE_MS = 30_000;

let cached: { labels: WaLabel[]; contacts: WaContact[] } | null = null;
let lastFetchAt = 0;

export async function getWaData(api: ApiFn): Promise<{ labels: WaLabel[]; contacts: WaContact[] }> {
  const now = Date.now();
  if (cached && now - lastFetchAt < WA_DATA_STALE_MS) {
    return cached;
  }
  const w = await api("/api/public/extension/wa/data");
  lastFetchAt = now;
  if (w?.ok) {
    cached = {
      labels: (w.labels as WaLabel[]) || [],
      contacts: (w.contacts as WaContact[]) || [],
    };
  }
  return cached ?? { labels: [], contacts: [] };
}
