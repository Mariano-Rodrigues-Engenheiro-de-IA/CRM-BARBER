// Garante que os funis padrão (Funil principal + Listas) existem e estão
// sincronizados com as etiquetas reais do WhatsApp. Extraído de
// funnels-view.tsx (19/09) — até então essa sincronização só rodava
// quando a aba Funis era aberta; quem fosse direto pra aba Disparo via
// dados de "Listas" desatualizados (sem etiquetas criadas recentemente
// no WhatsApp, por exemplo), sem nunca ter passado pela aba Funis
// naquela sessão. Bug real reportado pelo usuário ("as listas sempre
// deram um problema, não sincronizam direito").

import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";

export type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

/** Trava global (compartilhada entre Funis e Disparo) para evitar que
 * múltiplos componentes montados ao mesmo tempo criem funis padrão em
 * paralelo. */
let isEnsuringDefaults = false;

/** Garante exatamente 1 "Funil principal" (mode: tab) e exatamente 1
 * "Listas" (mode: label) por barbearia — cria se não existir, remove
 * duplicados se houver mais de 1. Retorna true se algo foi criado/
 * alterado (sinal pra quem chamou recarregar a lista de funis). */
export async function ensureDefaultFunnels(api: ApiFn, list: Funnel[]): Promise<boolean> {
  if (isEnsuringDefaults) return false;
  isEnsuringDefaults = true;
  try {
    let created = false;

    // 1) Garantir apenas UM funil principal (mode: tab)
    const tabFunnels = list.filter((f) => f.mode === "tab" || f.name === "Funil principal");
    if (tabFunnels.length === 0) {
      const r = await api("/api/public/extension/funnels", {
        method: "POST",
        body: JSON.stringify({
          name: "Funil principal",
          mode: "tab",
          stages: ["Novo lead", "Em conversa", "Negociando", "Fechado"],
        }),
      });
      created = created || Boolean(r?.ok);
    } else if (tabFunnels.length > 1) {
      const keep = tabFunnels.find((f) => f.mode === "tab") || tabFunnels[0];
      for (const dup of tabFunnels) {
        if (dup.id === keep.id) continue;
        await api(`/api/public/extension/funnels/${dup.id}`, { method: "DELETE" });
        created = true;
      }
    }

    // 2) Garantir apenas UM funil de listas (mode: label)
    const labelFunnels = list.filter((f) => f.mode === "label");
    if (labelFunnels.length === 0) {
      const r = await api("/api/public/extension/funnels", {
        method: "POST",
        body: JSON.stringify({ name: "Listas", mode: "label", stages: [] }),
      });
      created = created || Boolean(r?.ok);
    } else if (labelFunnels.length > 1) {
      const keep = labelFunnels.find((f) => f.name === "Listas") || labelFunnels[0];
      for (const dup of labelFunnels) {
        if (dup.id === keep.id) continue;
        await api(`/api/public/extension/funnels/${dup.id}`, { method: "DELETE" });
        created = true;
      }
    }

    // 3) Renomear legado se necessário
    const legacy = list.find((f) => f.mode === "label" && f.name !== "Listas");
    if (legacy && labelFunnels.length === 1) {
      await api(`/api/public/extension/funnels/${legacy.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: "Listas" }),
      });
      created = true;
    }

    return created;
  } finally {
    isEnsuringDefaults = false;
  }
}

/** Sincroniza as ETAPAS do funil "Listas" com as etiquetas reais do
 * WhatsApp (nome, cor, ordem) — cria etapas novas, remove as que não
 * existem mais, corrige duplicadas. Não mexe em contatos (renderizados
 * direto do snapshot do WhatsApp, não guardados como cards). */
export async function syncLabelFunnel(api: ApiFn, list: Funnel[], ls: WaLabel[]): Promise<boolean> {
  const funnel = list.find((f) => f.mode === "label");
  if (!funnel) return false;

  const seenNames = new Set<string>();
  const duplicateIds: string[] = [];
  for (const s of [...funnel.stages].sort((a, b) => a.sort_order - b.sort_order)) {
    if (seenNames.has(s.name)) {
      duplicateIds.push(s.id);
    } else {
      seenNames.add(s.name);
    }
  }
  const uniqueStages = funnel.stages.filter((s) => !duplicateIds.includes(s.id));

  const byName = new Map(uniqueStages.map((s) => [s.name, s]));
  const stale = uniqueStages.filter((s) => !ls.some((l) => l.name === s.name));
  const missing = ls.filter((l) => !byName.has(l.name));
  const hasColorChange = ls.some((l) => {
    const stage = byName.get(l.name);
    return stage && stage.color !== l.color;
  });

  if (stale.length || missing.length || duplicateIds.length || hasColorChange) {
    await api(`/api/public/extension/funnels/${funnel.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        stages: ls.map((l, i) => {
          const found = byName.get(l.name);
          return found
            ? { id: found.id, name: l.name, color: l.color, sort_order: i }
            : { name: l.name, color: l.color, sort_order: i };
        }),
        removed_stage_ids: [...stale.map((s) => s.id), ...duplicateIds],
      }),
    });
    return true;
  }

  return false;
}

/** Roda ensureDefaultFunnels + syncLabelFunnel em sequência, e retorna a
 * lista de funis já atualizada (recarregando do servidor se algo mudou).
 * Uso: qualquer tela que precise de "Listas" sempre em dia (Disparo,
 * Funis), sem depender de outra tela ter rodado essa sincronização
 * antes. `reload` deve buscar a lista atual de funis no servidor. */
export async function ensureFreshLabelFunnels(
  api: ApiFn,
  currentFunnels: Funnel[],
  labels: WaLabel[],
  reload: () => Promise<Funnel[]>,
): Promise<Funnel[]> {
  const created = await ensureDefaultFunnels(api, currentFunnels);
  const afterDefaults = created ? await reload() : currentFunnels;
  const synced = await syncLabelFunnel(api, afterDefaults, labels);
  return synced ? await reload() : afterDefaults;
}
