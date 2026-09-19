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

import { useEffect, useRef, useState } from "react";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  QUICK_REPLY_FUNNEL_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import { AudienceStep } from "@/components/dispatch-step-audience";
import { MessagePreview, TemplatePreview } from "@/components/dispatch-message-preview";
import type { AudienceContact, DispatchCustomer } from "@/lib/dispatch-audience";
export type { DispatchCustomer } from "@/lib/dispatch-audience";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

type MessageMode = "custom" | "quick";
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
    reader.readAsDataURL(file);
  });
}

function acceptedFiles(type: QuickReplyActionType) {
  if (type === "image") return "image/*,.jpg,.jpeg,.png,.webp,.gif";
  if (type === "video") return "video/*,.mp4,.mov,.m4v,.3gp,.webm";
  return "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.amr";
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

  // ⚠️ Adicionado (19/09): wizard em etapas — etapa 1 é a nova seleção de
  // público (AudienceStep, com inclusão/exclusão por fonte + lista
  // nominal). Etapas 2/3 (mensagem, ritmo, termos) ainda usam a UI
  // existente por enquanto — redesenho delas fica pra uma próxima parte
  // do trabalho, combinada com o usuário.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [finalAudience, setFinalAudience] = useState<AudienceContact[]>([]);

  const [name, setName] = useState("");
  const [variants, setVariants] = useState<string[]>([""]);
  const [actions, setActions] = useState<QuickReplyAction[]>([{ type: "text", text: "" }]);
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [replyId, setReplyId] = useState("");
  const [messageOpen, setMessageOpen] = useState(false);
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
  const [paceMin, setPaceMin] = useState(20);
  const [paceMax, setPaceMax] = useState(60);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [f, q, w, t, st] = await Promise.all([
        api("/api/public/extension/funnels"),
        api("/api/public/extension/quick-replies"),
        api("/api/public/extension/wa/data"),
        api("/api/public/extension/whatsapp/templates"),
        api("/api/public/extension/whatsapp/status"),
      ]);
      if (f?.ok) {
        setFunnels((f.funnels as Funnel[]) || []);
      }
      if (q?.ok) setReplies((q.quick_replies as QuickReply[]) || []);
      if (w?.ok) {
        setLabels((w.labels as WaLabel[]) || []);
        setContacts((w.contacts as WaContact[]) || []);
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
        setErr("Esse modelo tem imagem no cabeçalho — envie uma imagem antes de disparar.");
        return;
      }
      const cardCount = templates.find((x) => x.name === selectedTemplate)?.carouselCardCount ?? 0;
      if (cardCount > 0 && carouselPaths.filter(Boolean).length < cardCount) {
        setErr(
          `Esse modelo é um carrossel de ${cardCount} cartões — envie a imagem de todos antes de disparar.`,
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
    <div className="mx-auto w-full max-w-xl">
      <h2 className="mb-4 text-center text-lg font-semibold text-neutral-900">Novo disparo</h2>

      {step === 1 ? (
        <div className="space-y-5 rounded-xl border border-neutral-300 bg-white p-6 shadow-sm">
          <AudienceStep
            funnels={funnels}
            contacts={contacts}
            labels={labels}
            customers={customers}
            cols={cols}
            isBarbearia={isBarbearia}
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
                          Esse modelo tem imagem no cabeçalho — a Meta exige uma imagem em todo
                          envio (mesma pra todos os contatos desse disparo).
                        </p>
                        {templateHeaderPreview && (
                          <img
                            src={templateHeaderPreview}
                            alt="Prévia do cabeçalho"
                            className="mb-2 max-h-32 rounded-lg border border-neutral-200 object-cover"
                          />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          disabled={templateHeaderUploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleTemplateHeaderFile(file);
                          }}
                          className="block w-full text-sm text-neutral-600"
                        />
                        {templateHeaderUploading && (
                          <p className="mt-1 text-xs text-neutral-500">Enviando imagem…</p>
                        )}
                      </div>
                    )}
                  {isMetaProvider &&
                    (templates.find((t) => t.name === selectedTemplate)?.carouselCardCount ?? 0) >
                      0 && (
                      <div className="mt-3 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                        <Label>Imagens do carrossel</Label>
                        <p className="mb-2 text-xs text-neutral-500">
                          Esse modelo é um carrossel — a Meta exige uma imagem por cartão em todo
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
                              <input
                                type="file"
                                accept="image/*"
                                disabled={carouselUploadingIndex === i}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) void handleCarouselCardFile(i, file);
                                }}
                                className="block w-full text-sm text-neutral-600"
                              />
                              {carouselUploadingIndex === i && (
                                <p className="mt-1 text-xs text-neutral-500">Enviando imagem…</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <div>
                  <Label>Mensagem</Label>
                  <button
                    type="button"
                    onClick={() => setMessageOpen(true)}
                    className="flex w-full items-center justify-between rounded-xl border border-neutral-300 bg-white px-3 py-3 text-left text-sm text-neutral-900 hover:border-neutral-500"
                  >
                    <span className="min-w-0 truncate">
                      {replyId
                        ? replies.find((reply) => reply.id === replyId)?.title
                        : actions.some((action) => action.type !== "text") ||
                            variants.some((variant) => variant.trim())
                          ? `${actions.length} ação(ões) definida(s)`
                          : "Definir mensagem"}
                    </span>
                    <span aria-hidden="true" className="text-neutral-400">
                      ›
                    </span>
                  </button>
                </div>
              )}

              {isMetaProvider ? (
                <TemplatePreview
                  bodyText={templates.find((t) => t.name === selectedTemplate)?.bodyText || ""}
                  headerImageUrl={templateHeaderPreview}
                  carouselImageUrls={carouselPreviews}
                />
              ) : (
                <MessagePreview actions={actions} variantPreview={variants[0]} />
              )}

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
                className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                Próxima etapa
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
                <p className="font-semibold text-neutral-900">{name || "Sem nome"}</p>
                <p>
                  {isMetaProvider ? `Modelo: ${selectedTemplate || "—"}` : "Mensagem personalizada"}{" "}
                  · {total} destinatário(s)
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Ritmo mínimo (seg)</Label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={paceMin}
                    onChange={(e) => setPaceMin(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <Label>Ritmo máximo (seg)</Label>
                  <input
                    type="number"
                    min={5}
                    max={600}
                    value={paceMax}
                    onChange={(e) => setPaceMax(Number(e.target.value))}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-sm font-semibold text-neutral-900">Termo de uso</p>
                <p className="mt-2 text-sm leading-relaxed text-neutral-700">
                  A pratica de envios em massa ou spam podem ocasionar o banimento do seu número por
                  parte do WhatsApp. Envie mensagens apenas para pessoas que gostariam de receber
                  sua mensagem.
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

              <button
                disabled={busy || !accepted}
                className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
              >
                {busy ? "Criando..." : "Disparar"}
              </button>
            </>
          )}

          {messageOpen && (
            <MessageComposer
              api={api}
              funnels={funnels}
              replies={replies}
              mode={messageMode}
              replyId={replyId}
              actions={actions}
              variants={variants}
              onClose={() => setMessageOpen(false)}
              onMode={setMessageMode}
              onPickReply={pickReply}
              onActions={setActions}
              onVariants={setVariants}
              onClearReply={() => setReplyId("")}
            />
          )}
        </form>
      )}
    </div>
  );
}

function MessageComposer({
  api,
  funnels,
  replies,
  mode,
  replyId,
  actions,
  variants,
  onClose,
  onMode,
  onPickReply,
  onActions,
  onVariants,
  onClearReply,
}: {
  api: ApiFn;
  funnels: Funnel[];
  replies: QuickReply[];
  mode: MessageMode;
  replyId: string;
  actions: QuickReplyAction[];
  variants: string[];
  onClose: () => void;
  onMode: (mode: MessageMode) => void;
  onPickReply: (id: string) => void;
  onActions: React.Dispatch<React.SetStateAction<QuickReplyAction[]>>;
  onVariants: React.Dispatch<React.SetStateAction<string[]>>;
  onClearReply: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadIndex = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function updateAction(index: number, patch: Partial<QuickReplyAction>) {
    onActions((list) =>
      list.map((action, current) => (current === index ? { ...action, ...patch } : action)),
    );
  }

  function addAction(type: QuickReplyActionType) {
    onClearReply();
    onActions((list) => [...list, type === "text" ? { type, text: "" } : { type }]);
    if (type === "text" && !variants.length) onVariants([""]);
  }

  async function upload(file: File) {
    const index = uploadIndex.current;
    if (index === null) return;
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await fileToBase64(file);
      const result = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataBase64 }),
      });
      if (!result?.ok) throw new Error((result?.error as string) || "Falha no upload");
      updateAction(index, {
        path: result.path as string,
        url: result.url as string,
        mime: result.mime as string,
        filename: result.filename as string,
      });
    } catch (uploadError) {
      setError(String((uploadError as Error)?.message || uploadError));
    } finally {
      setBusy(false);
      uploadIndex.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mt-8 w-full max-w-2xl rounded-xl border border-neutral-300 bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-neutral-900">Mensagem do disparo</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              onMode("custom");
              onClearReply();
            }}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "custom" ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-700"}`}
          >
            Criar mensagem
          </button>
          <button
            type="button"
            onClick={() => onMode("quick")}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${mode === "quick" ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-700"}`}
          >
            Resposta rápida
          </button>
        </div>

        {mode === "quick" ? (
          <div className="mt-4 space-y-2">
            {replies.map((reply) => (
              <button
                key={reply.id}
                type="button"
                onClick={() => onPickReply(reply.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left text-sm ${replyId === reply.id ? "border-neutral-900 bg-neutral-50 font-semibold" : "border-neutral-200"}`}
              >
                <span>{reply.title}</span>
                <span>{reply.actions.length} ação(ões)</span>
              </button>
            ))}
            {!replies.length && (
              <p className="text-sm text-neutral-500">Nenhuma resposta rápida cadastrada.</p>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {actions.map((action, index) => (
              <div
                key={`${action.type}-${index}`}
                className="rounded-lg border border-neutral-200 bg-neutral-50 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-700">
                    {index + 1}. {actionLabel(action.type)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onActions((list) => list.filter((_, current) => current !== index))
                    }
                    className="text-xs text-red-600"
                  >
                    Remover
                  </button>
                </div>
                {action.type === "text" ? (
                  <div className="mt-2 space-y-2">
                    {variants.map((variant, variantIndex) => (
                      <textarea
                        key={variantIndex}
                        value={variant}
                        onChange={(event) => {
                          const value = event.target.value;
                          onVariants((list) =>
                            list.map((item, current) => (current === variantIndex ? value : item)),
                          );
                          if (variantIndex === 0) updateAction(index, { text: value });
                        }}
                        rows={3}
                        placeholder={`Variação ${variantIndex + 1}`}
                        className={inputCls}
                      />
                    ))}
                    {variants.length < 3 && (
                      <button
                        type="button"
                        onClick={() => onVariants((list) => [...list, ""])}
                        className="text-xs font-medium text-neutral-700"
                      >
                        + Adicionar variação
                      </button>
                    )}
                  </div>
                ) : action.type === "funnel_add" || action.type === "funnel_remove" ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={action.funnel_id ?? ""}
                      onChange={(event) =>
                        updateAction(index, {
                          funnel_id: event.target.value || undefined,
                          stage_id: undefined,
                        })
                      }
                      className={inputCls}
                    >
                      <option value="">Escolha o funil</option>
                      {funnels
                        .filter((funnel) => funnel.mode !== "label")
                        .map((funnel) => (
                          <option key={funnel.id} value={funnel.id}>
                            {funnel.name}
                          </option>
                        ))}
                    </select>
                    {action.type === "funnel_add" && (
                      <select
                        value={action.stage_id ?? ""}
                        onChange={(event) =>
                          updateAction(index, { stage_id: event.target.value || undefined })
                        }
                        className={inputCls}
                      >
                        <option value="">Escolha a coluna</option>
                        {(
                          funnels.find((funnel) => funnel.id === action.funnel_id)?.stages ?? []
                        ).map((stage) => (
                          <option key={stage.id} value={stage.id}>
                            {stage.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        uploadIndex.current = index;
                        if (fileInput.current)
                          fileInput.current.accept = acceptedFiles(action.type);
                        fileInput.current?.click();
                      }}
                      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {action.path
                        ? action.filename || "Trocar arquivo"
                        : `Escolher ${actionLabel(action.type).toLowerCase()}`}
                    </button>
                    <input
                      value={action.caption ?? ""}
                      onChange={(event) => updateAction(index, { caption: event.target.value })}
                      placeholder="Legenda (opcional)"
                      className={inputCls}
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              {[...QUICK_REPLY_ACTION_TYPES, ...QUICK_REPLY_FUNNEL_TYPES].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addAction(type)}
                  className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
                >
                  + {actionLabel(type)}
                </button>
              ))}
            </div>
          </div>
        )}

        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
