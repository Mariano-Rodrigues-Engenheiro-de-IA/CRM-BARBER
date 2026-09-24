// Aba Campanhas — "marketplace" de campanhas sazonais prontas.
// Estrutura: calendário no topo (12 meses, clica e vê as campanhas
// daquele mês, cada uma com capa/tema/ideia/copy pronta) + "Minhas
// campanhas" embaixo (o que o usuário já adotou, pronto pra disparar
// ou aguardando aprovação da Meta).

import { useEffect, useMemo, useState } from "react";
import type { ApiFn } from "@/lib/label-funnel-sync";

type CatalogCampaign = {
  id: string;
  title: string;
  month: number | null;
  theme: string | null;
  idea_summary: string;
  suggested_copy: string;
  cover_image_url: string | null;
  message_image_url: string | null;
};

export type SavedCampaign = {
  id: string;
  catalog_campaign_id: string | null;
  title: string;
  body_text: string;
  image_path: string | null;
  status: "draft" | "pending_approval" | "approved" | "rejected";
  rejection_reason: string | null;
  whatsapp_template_name: string | null;
  created_at: string;
};

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

// Mesmo ícone usado na aba Disparo (IconSend em painel.tsx) — pedido
// explícito do usuário, nada de emoji.
function IconSend() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

const STATUS_LABEL: Record<SavedCampaign["status"], { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-neutral-100 text-neutral-600" },
  pending_approval: { label: "Em análise na Meta", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "Pronta", cls: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Rejeitada", cls: "bg-red-100 text-red-700" },
};

export function CampaignsMarketplaceView({
  api,
  isMetaProvider,
  onUseCampaign,
}: {
  api: ApiFn;
  isMetaProvider: boolean;
  // Botão "Usar campanha" (só aparece pra campanhas prontas, status
  // "approved") — leva direto pra aba Disparo, já com essa campanha
  // pré-selecionada como mensagem.
  onUseCampaign: (campaignId: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogCampaign[] | null>(null);
  const [saved, setSaved] = useState<SavedCampaign[] | null>(null);
  const [unlockedThroughMonth, setUnlockedThroughMonth] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [openMonth, setOpenMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [detail, setDetail] = useState<CatalogCampaign | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(true);

  useEffect(() => {
    api("/api/public/extension/billing").then((r) => {
      setIsPremium(r?.ok ? Boolean((r.billing as any)?.premium) : true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    try {
      const r = await api("/api/public/extension/campaigns/catalog");
      if (r?.ok) {
        setCatalog((r.catalog as CatalogCampaign[]) ?? []);
        setSaved((r.saved as SavedCampaign[]) ?? []);
        const unlocked = (r.unlocked_through_month as number) ?? 12;
        setUnlockedThroughMonth(unlocked);
        setOpenMonth((current) => (current !== null && current > unlocked ? unlocked : current));
      } else {
        setError((r?.error as string) ?? "Não foi possível carregar as campanhas.");
      }
    } catch {
      setError("Não foi possível carregar as campanhas.");
    }
  }

  useState(() => {
    void load();
  });

  const byMonth = useMemo(() => {
    const map = new Map<number, CatalogCampaign[]>();
    for (const c of catalog ?? []) {
      if (c.month == null) continue;
      const list = map.get(c.month) ?? [];
      list.push(c);
      map.set(c.month, list);
    }
    return map;
  }, [catalog]);

  const timeless = useMemo(() => (catalog ?? []).filter((c) => c.month == null), [catalog]);

  async function handleAdopt(c: CatalogCampaign) {
    const r = await api("/api/public/extension/campaigns/catalog", {
      method: "POST",
      body: JSON.stringify({
        catalog_campaign_id: c.id,
        title: c.title,
        body_text: c.suggested_copy,
        image_path: c.message_image_url,
      }),
    });
    if (r?.ok) {
      setDetail(null);
      await load();
    } else {
      setError((r?.error as string) ?? "Não foi possível adotar essa campanha.");
    }
  }

  async function handleDeleteSaved(s: SavedCampaign) {
    if (!confirm(`Remover "${s.title}" das suas campanhas?`)) return;
    await api(`/api/public/extension/campaigns/saved/${s.id}`, { method: "DELETE" });
    await load();
  }

  async function handleSubmitForApproval(s: SavedCampaign) {
    setSubmittingId(s.id);
    try {
      const r = await api(`/api/public/extension/campaigns/saved/${s.id}/submit`, {
        method: "POST",
      });
      if (!r?.ok) {
        setError((r?.error as string) ?? "Não foi possível enviar essa campanha pra aprovação.");
      }
      await load();
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="space-y-8 p-5">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ===== Calendário ===== */}
      <div>
        <h2 className="text-lg font-bold text-neutral-900">Calendário de campanhas</h2>
        <p className="mb-4 text-sm text-neutral-500">
          Campanhas prontas pra cada época do ano. Escolha o mês, veja a ideia e a copy, e use com
          um clique.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {MONTH_NAMES.map((name, i) => {
            const monthNum = i + 1;
            const count = byMonth.get(monthNum)?.length ?? 0;
            const active = openMonth === monthNum;
            const locked = monthNum > unlockedThroughMonth;
            return (
              <button
                key={name}
                onClick={() => {
                  if (locked) return;
                  setOpenMonth(active ? null : monthNum);
                }}
                className={
                  "relative rounded-xl border px-3 py-3 text-left text-sm font-semibold transition " +
                  (locked
                    ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-300"
                    : active
                      ? "border-brand bg-brand text-white shadow-md"
                      : count > 0
                        ? "border-neutral-300 bg-white text-neutral-900 hover:border-brand"
                        : "border-neutral-200 bg-neutral-50 text-neutral-400")
                }
              >
                {name}
                {locked ? (
                  <span className="absolute right-2 top-2 text-neutral-400">🔒</span>
                ) : (
                  count > 0 && (
                    <span
                      className={
                        "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold " +
                        (active ? "bg-white text-brand" : "bg-brand text-white")
                      }
                    >
                      {count}
                    </span>
                  )
                )}
              </button>
            );
          })}
        </div>

        {openMonth && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(byMonth.get(openMonth) ?? []).length === 0 ? (
              <p className="col-span-full rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
                Nenhuma campanha cadastrada pra {MONTH_NAMES[openMonth - 1]} ainda.
              </p>
            ) : (
              byMonth
                .get(openMonth)!
                .map((c) => <CampaignCard key={c.id} campaign={c} onOpen={() => setDetail(c)} />)
            )}
          </div>
        )}

        {timeless.length > 0 && (
          <div className="mt-8">
            <h3 className="mb-3 text-sm font-semibold text-neutral-700">Disponíveis o ano todo</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {timeless.map((c) => (
                <CampaignCard key={c.id} campaign={c} onOpen={() => setDetail(c)} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ===== Minhas campanhas ===== */}
      <div>
        <h2 className="text-lg font-bold text-neutral-900">Minhas campanhas</h2>
        <p className="mb-4 text-sm text-neutral-500">
          O que você já adotou, pronto pra usar no disparo
          {isMetaProvider ? " (ou aguardando aprovação da Meta)" : ""}.
        </p>
        {!saved || saved.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-400">
            Você ainda não adotou nenhuma campanha do calendário acima.
          </p>
        ) : (
          <div className="max-w-md space-y-2">
            {saved.map((s) => {
              const st = STATUS_LABEL[s.status];
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3"
                >
                  {s.image_path ? (
                    <img
                      src={s.image_path}
                      alt=""
                      className="h-14 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="h-14 w-20 shrink-0 rounded-lg bg-neutral-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">{s.title}</p>
                    <p className="truncate text-xs text-neutral-400">{s.body_text}</p>
                    {s.status === "rejected" && s.rejection_reason && (
                      <p className="mt-0.5 truncate text-xs text-red-600">
                        Motivo: {s.rejection_reason}
                      </p>
                    )}
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold " + st.cls
                    }
                  >
                    {st.label}
                  </span>
                  {s.status === "approved" && (
                    <button
                      onClick={() => onUseCampaign(s.id)}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong"
                    >
                      <IconSend />
                      Enviar
                    </button>
                  )}
                  {isMetaProvider && (s.status === "draft" || s.status === "rejected") && (
                    <button
                      onClick={() => handleSubmitForApproval(s)}
                      disabled={submittingId === s.id}
                      className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                    >
                      {submittingId === s.id
                        ? "Enviando..."
                        : s.status === "rejected"
                          ? "Reenviar pra aprovação"
                          : "Enviar pra aprovação"}
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteSaved(s)}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Remover
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detail && (
        <CampaignDetailModal
          campaign={detail}
          isMetaProvider={isMetaProvider}
          isPremium={isPremium}
          onClose={() => setDetail(null)}
          onAdopt={() => handleAdopt(detail)}
        />
      )}
    </div>
  );
}

function CampaignCard({ campaign, onOpen }: { campaign: CatalogCampaign; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group overflow-hidden rounded-xl border border-neutral-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100">
        {campaign.cover_image_url ? (
          <img
            src={campaign.cover_image_url}
            alt=""
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">🎯</div>
        )}
      </div>
      <div className="p-3">
        {campaign.theme && (
          <span className="mb-1.5 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
            {campaign.theme}
          </span>
        )}
        <p className="text-sm font-semibold text-neutral-900">{campaign.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-500">{campaign.idea_summary}</p>
      </div>
    </button>
  );
}

function CampaignDetailModal({
  campaign,
  isMetaProvider,
  isPremium,
  onClose,
  onAdopt,
}: {
  campaign: CatalogCampaign;
  isMetaProvider: boolean;
  isPremium: boolean;
  onClose: () => void;
  onAdopt: () => void;
}) {
  const [adopting, setAdopting] = useState(false);

  async function handleClick() {
    setAdopting(true);
    try {
      await onAdopt();
    } finally {
      setAdopting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white">
        {campaign.cover_image_url && (
          <img src={campaign.cover_image_url} alt="" className="h-40 w-full object-cover" />
        )}
        <div className="space-y-4 p-6">
          <div>
            {campaign.theme && (
              <span className="mb-1.5 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                {campaign.theme}
              </span>
            )}
            <h2 className="text-lg font-bold text-neutral-900">{campaign.title}</h2>
          </div>
          <div>
            <p className="text-xs font-semibold text-neutral-500">A ideia</p>
            <p className="text-sm text-neutral-700">{campaign.idea_summary}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-neutral-500">Copy pronta</p>
            <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">
              {campaign.suggested_copy}
            </p>
          </div>
          {campaign.message_image_url && (
            <div>
              <p className="text-xs font-semibold text-neutral-500">Imagem da mensagem</p>
              <img
                src={campaign.message_image_url}
                alt=""
                className="max-h-40 rounded-lg border border-neutral-200 object-cover"
              />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600"
            >
              Fechar
            </button>
            {isPremium ? (
              <button
                onClick={handleClick}
                disabled={adopting}
                className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {adopting ? "Salvando..." : isMetaProvider ? "Usar modelo" : "Usar campanha"}
              </button>
            ) : (
              <a
                href={`${window.location.origin}/assinar?plano=premium_197`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
                </svg>
                Usar é Premium
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
