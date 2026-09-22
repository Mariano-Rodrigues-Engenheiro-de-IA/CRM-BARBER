// Central de disparo — único lugar do CRM onde se cria campanha.
//
// Público possível:
//   • Assinantes → coluna (status) do kanban de assinaturas (só existe
//     pra barbearia — isBarbearia controla isso)
//   • Listas     → lista nativa do WhatsApp já sincronizada (wa_labels)
//   • Funis      → funil + coluna
//
// O conteúdo (mensagem manual ou resposta rápida), o ritmo e o termo de uso
// são idênticos para os três públicos.

import { useEffect, useState } from "react";
import { type QuickReply, type QuickReplyAction } from "@/lib/quick-replies";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import { AudienceStep } from "@/components/dispatch-step-audience";
import { MessageComposerStep } from "@/components/dispatch-step-message";
import type { SavedCampaign } from "@/components/campaigns-marketplace-view";
import { MessagePreview } from "@/components/dispatch-message-preview";
import { TemplatePreview } from "@/components/whatsapp-template-preview";
import type { AudienceContact, AudienceSource, DispatchCustomer } from "@/lib/dispatch-audience";
export type { DispatchCustomer } from "@/lib/dispatch-audience";
import { ensureFreshLabelFunnels } from "@/lib/label-funnel-sync";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

type MessageMode = "custom" | "quick" | "campaign";
type DispatchType = "message" | "template";
type TemplateOption = {
  name: string;
  language: string;
  status: string;
  hasImageHeader: boolean;
  carouselCardCount: number;
  bodyText: string;
};

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-900";

function nudgeExtensionPoll() {
  if (typeof window === "undefined") return;
  window.postMessage({ __crm: "poll_now_v180" }, window.location.origin);
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-600">{children}</label>;
}

/** Barra deslizante com o valor atual sempre visível enquanto o usuário
 * arrasta — pedido explícito do usuário pras configurações de ritmo e
 * pausa, no lugar de campos numéricos simples. */
function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  helpText,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  helpText?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-semibold text-neutral-900">
          {value} {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
      {helpText && <p className="mt-1 text-xs text-neutral-500">{helpText}</p>}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

export function DispatchCenter({
  api,
  customers,
  cols,
  onNeedConnection,
  onDone,
  isBarbearia,
}: {
  api: ApiFn;
  customers: DispatchCustomer[];
  cols: Array<{ key: string; label: string }>;
  onNeedConnection: () => void;
  onDone: () => void;
  // "Assinantes" é conceito exclusivo de barbearia (kanban de
  // assinatura) — vazava pro nicho genérico/clínica, que nunca tem
  // esse kanban. Achado de bug real reportado pelo Mariano.
  isBarbearia: boolean;
}) {
  // Funis
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  // Contatos e etiquetas do WhatsApp sincronizados — necessários pra calcular
  // corretamente o público de funis do tipo "label" (Listas), já que os
  // cards dessas colunas não ficam persistidos em funnel_cards; eles são
  // recalculados na hora, igual em funnels-view.tsx (stageCards).
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [labels, setLabels] = useState<WaLabel[]>([]);

  // ⚠️ Wizard em etapas (19/09, reescrito no mesmo dia a partir de
  // feedback real de uso): source/selected da Etapa 1 vivem AQUI, no
  // componente pai, não dentro de AudienceStep — se fosse estado local,
  // se perderia toda vez que o wizard saísse da Etapa 1 (React desmonta
  // o componente ao trocar de step), fazendo a configuração "desaparecer"
  // ao voltar. Modelo de seleção acumulativa: origem é só um filtro de
  // exibição, a seleção real cresce/diminui via "Adicionar todos" /
  // "Remover todos" na origem exibida, ou toque individual, e persiste
  // ao trocar de origem.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [audienceSource, setAudienceSource] = useState<AudienceSource>({ kind: "inbox" });
  const [selectedAudience, setSelectedAudience] = useState<Map<string, AudienceContact>>(new Map());
  const [finalAudience, setFinalAudience] = useState<AudienceContact[]>([]);

  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [actions, setActions] = useState<QuickReplyAction[]>([{ type: "text", text: "" }]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>([]);
  const [replyId, setReplyId] = useState("");
  const [messageMode, setMessageMode] = useState<MessageMode>("custom");
  const [dispatchType, setDispatchType] = useState<DispatchType>("message");
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [templateHeaderPath, setTemplateHeaderPath] = useState<string | null>(null);
  const [templateHeaderPreview, setTemplateHeaderPreview] = useState<string | null>(null);
  const [templateHeaderUploading, setTemplateHeaderUploading] = useState(false);
  // Uma imagem por cartão do carrossel — arrays na mesma ordem dos
  // cartões do modelo (index 0 = primeiro cartão, e assim por diante).
  const [carouselPaths, setCarouselPaths] = useState<(string | null)[]>([]);
  const [carouselPreviews, setCarouselPreviews] = useState<(string | null)[]>([]);
  const [carouselUploadingIndex, setCarouselUploadingIndex] = useState<number | null>(null);
  const [paceMin, setPaceMin] = useState(30);
  const [paceMax, setPaceMax] = useState(60);
  // Pausa maior e periódica, a cada N contatos - diferente do ritmo
  // acima (intervalo entre CADA mensagem). Padrão pré-definido a
  // pedido do usuário (19/09): 20 contatos / 30s.
  const [pauseEveryContacts, setPauseEveryContacts] = useState(20);
  const [pauseSeconds, setPauseSeconds] = useState(30);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [f, q, w, t, st, camp] = await Promise.all([
        api("/api/public/extension/funnels"),
        api("/api/public/extension/quick-replies"),
        api("/api/public/extension/wa/data"),
        api("/api/public/extension/whatsapp/templates"),
        api("/api/public/extension/whatsapp/status"),
        api("/api/public/extension/campaigns/catalog"),
      ]);
      if (f?.ok) {
        setFunnels((f.funnels as Funnel[]) || []);
      }
      if (q?.ok) setReplies((q.quick_replies as QuickReply[]) || []);
      if (camp?.ok) {
        const all = (camp.saved as SavedCampaign[]) || [];
        setSavedCampaigns(all.filter((c) => c.status === "approved"));
      }
      if (w?.ok) {
        setLabels((w.labels as WaLabel[]) || []);
        setContacts((w.contacts as WaContact[]) || []);
      }
      // Garante que "Listas" existe e está em dia com as etiquetas reais
      // do WhatsApp — antes só rodava se o usuário tivesse passado pela
      // aba Funis naquela sessão; indo direto pro Disparo, via dados
      // desatualizados (bug real reportado pelo usuário).
      if (f?.ok && w?.ok) {
        const freshFunnels = await ensureFreshLabelFunnels(
          api,
          (f.funnels as Funnel[]) || [],
          (w.labels as WaLabel[]) || [],
          async () => {
            const r = await api("/api/public/extension/funnels");
            return r?.ok ? (r.funnels as Funnel[]) || [] : [];
          },
        );
        setFunnels(freshFunnels);
      }
      // Falha silenciosa aqui é aceitável: sem conexão via API oficial
      // ainda, esse endpoint dá erro — a opção "Modelo aprovado" só
      // aparece disponível se a lista carregar com sucesso.
      if (t?.ok) {
        setTemplates(
          (
            (t.templates as Array<{
              name: string;
              language: string;
              status: string;
              components?: Array<{
                type?: string;
                format?: string;
                text?: string;
                cards?: unknown[];
              }>;
            }>) || []
          ).map((tpl) => {
            const carouselComp = (tpl.components || []).find(
              (c) => String(c.type).toUpperCase() === "CAROUSEL",
            );
            const bodyComp = (tpl.components || []).find(
              (c) => String(c.type).toUpperCase() === "BODY",
            );
            return {
              name: tpl.name,
              language: tpl.language,
              status: tpl.status,
              hasImageHeader: (tpl.components || []).some(
                (c) =>
                  String(c.type).toUpperCase() === "HEADER" &&
                  String(c.format).toUpperCase() === "IMAGE",
              ),
              carouselCardCount: Array.isArray(carouselComp?.cards) ? carouselComp.cards.length : 0,
              bodyText: bodyComp?.text || "",
            };
          }),
        );
      }
      if (st?.ok && st.connection) {
        const meta = (st.connection as { provider?: string }).provider === "meta";
        setIsMetaProvider(meta);
        // Disparo em massa pela API oficial só funciona com modelo
        // aprovado (a maioria dos contatos estará fora da janela de 24h) —
        // não oficial (QR) só funciona com mensagem livre. Não é uma
        // escolha do usuário, é uma limitação de cada modo.
        setDispatchType(meta ? "template" : "message");
      }
      setTemplatesLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = finalAudience.length;

  function pickReply(id: string) {
    setReplyId(id);
    const qr = replies.find((q) => q.id === id);
    if (!qr) return;
    setActions(qr.actions);
    // Só pré-preenche "variantes" quando a Resposta Rápida tem 1 único
    // texto — nesse caso faz sentido usar como base editável. Quando tem
    // MÚLTIPLOS textos, são mensagens SEQUENCIAIS (devem ir todas, na
    // ordem, pra cada contato) — não são alternativas entre si. Copiar
    // pra "variantes" ativava o modo de rotacionar-uma-por-contato no
    // disparo, fragmentando a sequência entre pessoas diferentes.
    const texts = qr.actions
      .filter((a) => a.type === "text" && a.text?.trim())
      .map((a) => (a.text as string).trim());
    setVariants(texts.length === 1 ? texts : [""]);
    if (!name.trim()) setName(qr.title);
  }

  async function handleTemplateHeaderFile(file: File) {
    setTemplateHeaderUploading(true);
    setErr(null);
    try {
      const dataUrl = await fileToBase64(file);
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || "image/jpeg",
          data_base64: dataUrl,
        }),
      });
      if (!r?.ok) {
        setErr((r?.error as string) || "Falha ao enviar a imagem do cabeçalho.");
        return;
      }
      setTemplateHeaderPath((r.path as string) || null);
      setTemplateHeaderPreview(dataUrl);
    } finally {
      setTemplateHeaderUploading(false);
    }
  }

  /** Mesma ideia do cabeçalho simples, só que uma imagem POR CARTÃO do
   * carrossel — cada cartão faz upload e guarda o caminho na posição
   * certa do array (índice = posição do cartão no modelo). */
  async function handleCarouselCardFile(index: number, file: File) {
    setCarouselUploadingIndex(index);
    setErr(null);
    try {
      const dataUrl = await fileToBase64(file);
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || "image/jpeg",
          data_base64: dataUrl,
        }),
      });
      if (!r?.ok) {
        setErr((r?.error as string) || `Falha ao enviar a imagem do cartão ${index + 1}.`);
        return;
      }
      setCarouselPaths((prev) => {
        const next = [...prev];
        next[index] = (r.path as string) || null;
        return next;
      });
      setCarouselPreviews((prev) => {
        const next = [...prev];
        next[index] = dataUrl;
        return next;
      });
    } finally {
      setCarouselUploadingIndex(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    if (dispatchType === "template") {
      if (!name.trim() || !selectedTemplate) {
        setErr("Preencha o nome e escolha um modelo aprovado.");
        return;
      }
      const tplNeedsHeader = templates.find((x) => x.name === selectedTemplate)?.hasImageHeader;
      if (tplNeedsHeader && !templateHeaderPath) {
        setErr("Esse modelo tem imagem no cabeçalho, envie uma imagem antes de disparar.");
        return;
      }
      const cardCount = templates.find((x) => x.name === selectedTemplate)?.carouselCardCount ?? 0;
      if (cardCount > 0 && carouselPaths.filter(Boolean).length < cardCount) {
        setErr(
          `Esse modelo é um carrossel de ${cardCount} cartões, envie a imagem de todos antes de disparar.`,
        );
        return;
      }
      if (!accepted) {
        setErr("Você precisa aceitar o termo de uso para disparar.");
        return;
      }
      if (total === 0) {
        setErr("Nenhum contato com telefone válido nesse público.");
        return;
      }
      setBusy(true);
      setErr(null);
      const st = await api("/api/public/extension/whatsapp/status?sync=1");
      const conn = st?.connection as { status?: string } | undefined;
      if (!st?.ok || conn?.status !== "connected") {
        setBusy(false);
        onNeedConnection();
        return;
      }
      const tpl = templates.find((x) => x.name === selectedTemplate);
      const base = {
        name: name.trim(),
        template_name: selectedTemplate,
        template_language: tpl?.language || "pt_BR",
        ...(templateHeaderPath ? { template_header_media_path: templateHeaderPath } : {}),
        ...(cardCount > 0 ? { template_carousel_media_paths: carouselPaths } : {}),
        pace_seconds_min: Math.min(paceMin, paceMax),
        pace_seconds_max: Math.max(paceMin, paceMax),
        ...(pauseEveryContacts > 0
          ? { pause_every_contacts: pauseEveryContacts, pause_seconds: pauseSeconds }
          : {}),
      };
      const body = { ...base, scope: "funil", phone_targets: finalAudience };
      const r = await api("/api/public/extension/campaigns", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBusy(false);
      if (!r?.ok) {
        setErr((r?.error as string) || "Erro ao criar o disparo");
        return;
      }
      nudgeExtensionPoll();
      onDone();
      return;
    }

    const cleaned = variants.map((v) => v.trim()).filter(Boolean);
    const cleanActions = actions.filter((action) => {
      if (action.type === "text") return Boolean(action.text?.trim() || cleaned.length);
      if (action.type === "funnel_add") return Boolean(action.funnel_id && action.stage_id);
      if (action.type === "funnel_remove") return Boolean(action.funnel_id);
      return Boolean(action.path);
    });
    if (!name.trim() || cleanActions.length === 0) {
      setErr("Preencha o nome e defina a mensagem do disparo.");
      return;
    }
    if (!accepted) {
      setErr("Você precisa aceitar o termo de uso para disparar.");
      return;
    }
    if (total === 0) {
      setErr("Nenhum contato com telefone válido nesse público.");
      return;
    }

    setBusy(true);
    setErr(null);
    const st = await api("/api/public/extension/whatsapp/status?sync=1");
    const conn = st?.connection as { status?: string } | undefined;
    if (!st?.ok || conn?.status !== "connected") {
      // Sem conexão: leva direto pra aba Conexão, sem erro vermelho na tela.
      setBusy(false);
      onNeedConnection();
      return;
    }

    const base = {
      name: name.trim(),
      message_variants: cleaned.length ? cleaned : undefined,
      message_actions: cleanActions,
      pace_seconds_min: Math.min(paceMin, paceMax),
      pace_seconds_max: Math.max(paceMin, paceMax),
      ...(pauseEveryContacts > 0
        ? { pause_every_contacts: pauseEveryContacts, pause_seconds: pauseSeconds }
        : {}),
    };
    const body = { ...base, scope: "funil", phone_targets: finalAudience };

    const r = await api("/api/public/extension/campaigns", {
      method: "POST",
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao criar o disparo");
      return;
    }
    nudgeExtensionPoll();
    onDone();
  }

  return (
    <div className={"mx-auto w-full " + (step === 1 || step === 2 ? "max-w-3xl" : "max-w-xl")}>
      {step === 1 ? (
        <div className="space-y-5 rounded-xl border border-neutral-300 bg-white p-6 shadow-sm">
          <AudienceStep
            funnels={funnels}
            contacts={contacts}
            labels={labels}
            customers={customers}
            cols={cols}
            isBarbearia={isBarbearia}
            source={audienceSource}
            onSourceChange={setAudienceSource}
            selected={selectedAudience}
            onSelectedChange={setSelectedAudience}
            onNext={(list) => {
              setFinalAudience(list);
              setStep(2);
            }}
          />
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="space-y-5 rounded-xl border border-neutral-300 bg-white p-6 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep(step === 3 ? 2 : 1)}
              className="text-sm font-medium text-neutral-500 hover:text-neutral-800"
            >
              ← Voltar
            </button>
            <p className="text-sm font-medium text-neutral-700">
              {total} destinatário(s) selecionado(s)
            </p>
          </div>

          {step === 2 && (
            <>
              <div>
                <Label>Nome do disparo</Label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputCls}
                  placeholder="Ex.: Cobrança julho"
                />
              </div>

              <div>
                <Label>Tipo de disparo</Label>
                <p className="mt-1 text-sm font-medium text-neutral-800">
                  {isMetaProvider ? "Modelo aprovado" : "Mensagem personalizada"}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  {isMetaProvider ? (
                    <div>
                      <Label>Modelo</Label>
                      {!templatesLoaded ? (
                        <p className="text-sm text-neutral-500">Carregando modelos…</p>
                      ) : templates.filter((t) => t.status === "APPROVED").length === 0 ? (
                        <p className="text-sm text-neutral-500">
                          Nenhum modelo aprovado ainda. Cria um na aba "Modelos" e espera a Meta
                          aprovar.
                        </p>
                      ) : (
                        <select
                          value={selectedTemplate}
                          onChange={(e) => {
                            setSelectedTemplate(e.target.value);
                            // Trocar de modelo invalida a imagem escolhida antes —
                            // cada modelo tem seu próprio cabeçalho (ou nenhum).
                            setTemplateHeaderPath(null);
                            setTemplateHeaderPreview(null);
                            const tpl = templates.find((t) => t.name === e.target.value);
                            setCarouselPaths(new Array(tpl?.carouselCardCount || 0).fill(null));
                            setCarouselPreviews(new Array(tpl?.carouselCardCount || 0).fill(null));
                          }}
                          className={inputCls}
                        >
                          <option value="">Escolha um modelo…</option>
                          {templates
                            .filter((t) => t.status === "APPROVED")
                            .map((t) => (
                              <option key={t.name} value={t.name}>
                                {t.name}
                                {t.hasImageHeader ? " (tem imagem)" : ""}
                                {t.carouselCardCount > 0
                                  ? ` (carrossel, ${t.carouselCardCount} cartões)`
                                  : ""}
                              </option>
                            ))}
                        </select>
                      )}
                      {isMetaProvider &&
                        templates.find((t) => t.name === selectedTemplate)?.hasImageHeader && (
                          <div className="mt-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                            <Label>Imagem do cabeçalho</Label>
                            <p className="mb-2 text-xs text-neutral-500">
                              Esse modelo tem imagem no cabeçalho, a Meta exige uma imagem em todo
                              envio (mesma pra todos os contatos desse disparo).
                            </p>
                            {templateHeaderPreview && (
                              <img
                                src={templateHeaderPreview}
                                alt="Prévia do cabeçalho"
                                className="mb-2 max-h-32 rounded-lg border border-neutral-200 object-cover"
                              />
                            )}
                            <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand">
                              <input
                                type="file"
                                accept="image/*"
                                disabled={templateHeaderUploading}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) void handleTemplateHeaderFile(file);
                                }}
                                className="hidden"
                              />
                              {templateHeaderPreview ? "Trocar imagem" : "Escolher imagem"}
                            </label>
                            {templateHeaderUploading && (
                              <p className="mt-1 text-xs text-neutral-500">Enviando imagem…</p>
                            )}
                          </div>
                        )}
                      {isMetaProvider &&
                        (templates.find((t) => t.name === selectedTemplate)?.carouselCardCount ??
                          0) > 0 && (
                          <div className="mt-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                            <Label>Imagens do carrossel</Label>
                            <p className="mb-2 text-xs text-neutral-500">
                              Esse modelo é um carrossel, a Meta exige uma imagem por cartão em todo
                              envio (mesmas imagens pra todos os contatos desse disparo).
                            </p>
                            <div className="space-y-3">
                              {Array.from({
                                length:
                                  templates.find((t) => t.name === selectedTemplate)
                                    ?.carouselCardCount ?? 0,
                              }).map((_, i) => (
                                <div
                                  key={i}
                                  className="rounded-lg border border-neutral-200 bg-white p-2"
                                >
                                  <p className="mb-1 text-xs font-medium text-neutral-600">
                                    Cartão {i + 1}
                                  </p>
                                  {carouselPreviews[i] && (
                                    <img
                                      src={carouselPreviews[i] as string}
                                      alt={`Prévia do cartão ${i + 1}`}
                                      className="mb-2 max-h-28 rounded-lg border border-neutral-200 object-cover"
                                    />
                                  )}
                                  <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand">
                                    <input
                                      type="file"
                                      accept="image/*"
                                      disabled={carouselUploadingIndex === i}
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void handleCarouselCardFile(i, file);
                                      }}
                                      className="hidden"
                                    />
                                    {carouselPreviews[i] ? "Trocar imagem" : "Escolher imagem"}
                                  </label>
                                  {carouselUploadingIndex === i && (
                                    <p className="mt-1 text-xs text-neutral-500">
                                      Enviando imagem…
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  ) : (
                    <MessageComposerStep
                      api={api}
                      funnels={funnels}
                      replies={replies}
                      mode={messageMode}
                      replyId={replyId}
                      actions={actions}
                      variants={variants}
                      onMode={setMessageMode}
                      onPickReply={pickReply}
                      onActions={setActions}
                      onVariants={setVariants}
                      onClearReply={() => setReplyId("")}
                      savedCampaigns={savedCampaigns}
                    />
                  )}
                </div>

                <div>
                  {isMetaProvider ? (
                    (() => {
                      const tpl = templates.find((t) => t.name === selectedTemplate);
                      const templateType: "text" | "image" | "carousel" =
                        (tpl?.carouselCardCount ?? 0) > 0
                          ? "carousel"
                          : tpl?.hasImageHeader
                            ? "image"
                            : "text";
                      return (
                        <TemplatePreview
                          templateType={templateType}
                          mediaFile={
                            templateHeaderPreview
                              ? {
                                  dataUrl: templateHeaderPreview,
                                  mime: "image/jpeg",
                                  filename: "cabecalho.jpg",
                                }
                              : null
                          }
                          bodyText={tpl?.bodyText || ""}
                          bodyExamples={{}}
                          footerText=""
                          buttons={[]}
                          carouselCards={carouselPreviews.map((url) => ({
                            file: url
                              ? { dataUrl: url, mime: "image/jpeg", filename: "cartao.jpg" }
                              : null,
                            bodyText: "",
                          }))}
                          carouselButtons={[]}
                        />
                      );
                    })()
                  ) : (
                    <MessagePreview actions={actions} variantPreview={variants[0]} />
                  )}
                </div>
              </div>

              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={
                    isMetaProvider
                      ? !name.trim() || !selectedTemplate
                      : !name.trim() ||
                        !actions.some(
                          (a) =>
                            (a.type === "text" && (a.text?.trim() || variants[0]?.trim())) ||
                            (a.type !== "text" &&
                              a.type !== "funnel_add" &&
                              a.type !== "funnel_remove" &&
                              a.path),
                        )
                  }
                  onClick={() => setStep(3)}
                  title="Próxima etapa"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:border-brand hover:bg-brand hover:text-white disabled:opacity-30 disabled:hover:border-neutral-300 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                    <path
                      fillRule="evenodd"
                      d="M7.3 14.7a1 1 0 010-1.4L10.6 10 7.3 6.7a1 1 0 011.4-1.4l4 4a1 1 0 010 1.4l-4 4a1 1 0 01-1.4 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                <p className="font-semibold text-neutral-900">{name || "Sem nome"}</p>
                <p>
                  {isMetaProvider ? `Modelo: ${selectedTemplate || "-"}` : "Mensagem personalizada"}{" "}
                  · {total} destinatário(s)
                </p>
              </div>

              <div className="space-y-4">
                <SliderField
                  label="Ritmo mínimo"
                  value={paceMin}
                  min={5}
                  max={600}
                  unit="seg"
                  onChange={setPaceMin}
                />
                <SliderField
                  label="Ritmo máximo"
                  value={paceMax}
                  min={5}
                  max={600}
                  unit="seg"
                  onChange={setPaceMax}
                  helpText="A mensagem será enviada aleatoriamente entre o ritmo mínimo e o ritmo máximo definido."
                />
                <SliderField
                  label="Pausa a cada"
                  value={pauseEveryContacts}
                  min={0}
                  max={1000}
                  step={10}
                  unit="contatos"
                  onChange={setPauseEveryContacts}
                  helpText="Define a cada quantos contatos o sistema deverá realizar uma pausa. Deixe em 0 para não pausar."
                />
                <SliderField
                  label="Tempo de pausa"
                  value={pauseSeconds}
                  min={0}
                  max={500}
                  step={5}
                  unit="seg"
                  onChange={setPauseSeconds}
                  helpText="Define quanto tempo o sistema ficará pausado antes de continuar os envios."
                />
              </div>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-900">Termo de uso</p>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                  {isMetaProvider
                    ? "Mandar mensagens pra quem não te autorizou contato antes, ou receber muitas denúncias, pode reduzir o limite diário de mensagens da sua conta, ou levar a Meta a restringir o uso. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem."
                    : "A prática de envios em massa ou spam pode ocasionar o banimento do seu número por parte do WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber sua mensagem."}
                </p>
                <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                    className="h-4 w-4 rounded border-neutral-400"
                  />
                  Eu entendo e aceito os termos de uso.
                </label>
              </div>

              {err && <p className="text-sm text-red-500">{err}</p>}

              <div className="flex justify-center">
                <button
                  disabled={busy || !accepted}
                  className="rounded-lg bg-brand px-8 py-3 text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
                >
                  {busy ? "Criando..." : "Disparar"}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
