// Aba "Follow-up": mensagem(ns) programada(s) por etapa de funil OU
// lista, com painel único de configuração (4 seções). Pedido explícito
// do usuário (22/09, 2ª rodada): "assim que entrar" e "assim que sair"
// sempre mandam 1 mensagem só (mas com tempo configurável agora), só
// "um tempo parado" permite uma SEQUÊNCIA de várias mensagens.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Clock, FileText, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import type { Funnel } from "@/lib/funnels";
import {
  actionLabel,
  QUICK_REPLY_ACTION_TYPES,
  QUICK_REPLY_FUNNEL_TYPES,
  type QuickReply,
  type QuickReplyAction,
  type QuickReplyActionType,
} from "@/lib/quick-replies";
import type { SavedCampaign } from "@/components/campaigns-marketplace-view";

export type Api = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

export type FollowupContent = {
  id?: string; // presente quando veio do backend (passo já existente) — precisa ser preservado e reenviado no submit pra o backend conseguir ATUALIZAR em vez de apagar e recriar (senão perde o histórico de já enviado)
  delay_minutes: number;
  actions: QuickReplyAction[];
  template_name: string | null;
  template_language: string | null;
  template_header_media_path: string | null;
};

type FollowupRule = {
  id: string;
  name: string | null;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  trigger_type: "time_in_stage" | "left_stage";
  moment: "entered" | "left_stage" | "time_in_stage";
  skip_if_replied: boolean;
  steps: FollowupContent[];
};

export type TemplateOption = {
  name: string;
  language: string;
  status: string;
  hasImageHeader: boolean;
};
type Moment = "entered" | "left_stage" | "time_in_stage";
export type MessageSource = "write" | "quick_reply" | "campaign";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-brand";

export function acceptedFiles(type: QuickReplyActionType) {
  if (type === "image") return "image/*,.jpg,.jpeg,.png,.webp,.gif";
  if (type === "video") return "video/*,.mp4,.mov,.m4v,.3gp,.webm";
  return "audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.amr";
}

export function minutesToValueUnit(min: number): {
  value: number;
  unit: "minutos" | "horas" | "dias";
} {
  if (min % (60 * 24) === 0 && min > 0) return { value: min / (60 * 24), unit: "dias" };
  if (min % 60 === 0 && min > 0) return { value: min / 60, unit: "horas" };
  return { value: min, unit: "minutos" };
}
export function valueUnitToMinutes(value: number, unit: "minutos" | "horas" | "dias") {
  if (unit === "dias") return value * 60 * 24;
  if (unit === "horas") return value * 60;
  return value;
}

export function FollowupView({ api }: { api: Api }) {
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [rules, setRules] = useState<FollowupRule[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | "new" | null>(null);
  const [showReport, setShowReport] = useState(false);

  async function reloadAll() {
    const [f, r] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/funnel-followup-rules"),
    ]);
    if (f?.ok) setFunnels(((f.funnels as Funnel[]) || []).filter((fn) => fn.mode !== "postsale"));
    if (r?.ok) setRules((r.rules as FollowupRule[]) || []);
  }

  useEffect(() => {
    void reloadAll();
    api("/api/public/extension/whatsapp/status").then((st) => {
      if (st?.ok && st.connection) {
        setIsMetaProvider((st.connection as { provider?: string }).provider === "meta");
      }
    });
    api("/api/public/extension/whatsapp/templates")
      .then((t) => {
        if (!t?.ok) return;
        setTemplates(
          (
            (t.templates as Array<{
              name: string;
              language: string;
              status: string;
              components?: Array<{ type?: string; format?: string }>;
            }>) || []
          ).map((tpl) => ({
            name: tpl.name,
            language: tpl.language,
            status: tpl.status,
            hasImageHeader: (tpl.components || []).some(
              (c) =>
                String(c.type).toUpperCase() === "HEADER" &&
                String(c.format).toUpperCase() === "IMAGE",
            ),
          })),
        );
      })
      .catch(() => {});
    api("/api/public/extension/quick-replies").then((q) => {
      if (q?.ok) setQuickReplies((q.quick_replies as QuickReply[]) || []);
    });
    api("/api/public/extension/campaigns/catalog").then((c) => {
      if (c?.ok) {
        const all = (c.saved as SavedCampaign[]) || [];
        setSavedCampaigns(all.filter((s) => s.status === "approved"));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function labelFor(
    funnelId: string,
    stageId: string,
  ): { funnelName: string; stageName: string; isList: boolean } {
    const funnel = funnels?.find((f) => f.id === funnelId);
    const stage = funnel?.stages.find((s) => s.id === stageId);
    return {
      funnelName: funnel?.name || "Funil removido",
      stageName: stage?.name || "Etapa removida",
      isList: funnel?.mode === "label",
    };
  }

  function momentLabel(m: Moment): string {
    if (m === "entered") return "Assim que entrar";
    if (m === "left_stage") return "Assim que sair";
    return "Tempo parado";
  }

  const editingRule =
    editingRuleId && editingRuleId !== "new"
      ? rules.find((r) => r.id === editingRuleId) || null
      : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => setEditingRuleId("new")} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Novo follow-up
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowReport(true)} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Relatório completo
        </Button>
      </div>

      {!funnels ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm text-neutral-500">
            Nenhum follow-up configurado ainda. Clique em "Novo follow-up" pra criar o primeiro.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rules.map((rule) => {
            const { funnelName, stageName, isList } = labelFor(rule.funnel_id, rule.stage_id);
            return (
              <button
                key={rule.id}
                onClick={() => setEditingRuleId(rule.id)}
                className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {rule.name || (isList ? "Lista: " : "") + stageName}
                  </p>
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${rule.active ? "bg-emerald-500" : "bg-neutral-300"}`}
                  />
                </div>
                <p className="text-xs text-neutral-500">
                  {isList ? "Lista: " : `${funnelName} · `}
                  {stageName}
                </p>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {momentLabel(rule.moment)}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {rule.steps.length} mensage{rule.steps.length === 1 ? "m" : "ns"}
                  </span>
                  {!rule.active && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      pausado
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {editingRuleId && funnels && (
        <FollowupEditor
          api={api}
          funnels={funnels}
          rule={editingRule}
          existingRuleKeys={
            new Set(
              rules
                .filter((r) => r.id !== editingRuleId)
                .map((r) => `${r.funnel_id}:${r.stage_id}`),
            )
          }
          templates={templates}
          quickReplies={quickReplies}
          savedCampaigns={savedCampaigns}
          isMetaProvider={isMetaProvider}
          onClose={() => setEditingRuleId(null)}
          onSaved={() => {
            setEditingRuleId(null);
            void reloadAll();
          }}
        />
      )}

      {showReport && <FollowupReportModal api={api} onClose={() => setShowReport(false)} />}
    </div>
  );
}

function FollowupReportModal({ api, onClose }: { api: Api; onClose: () => void }) {
  const [entries, setEntries] = useState<Array<{
    id: string;
    card_title: string;
    phone: string;
    funnel_name: string;
    stage_name: string;
    sent_at: string;
  }> | null>(null);

  useEffect(() => {
    api("/api/public/extension/funnel-followup-report").then((r) => {
      if (r?.ok) setEntries((r.entries as typeof entries) || []);
      else setEntries([]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-neutral-900">Relatório de follow-up</h3>
            <p className="text-xs text-neutral-500">
              Todas as mensagens já enviadas, mais recentes primeiro.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {entries === null ? (
            <p className="p-5 text-sm text-neutral-500">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="p-5 text-sm text-neutral-500">
              Nenhuma mensagem de follow-up enviada ainda.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Funil / etapa</th>
                  <th className="px-3 py-2 font-medium">Enviado em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-neutral-900">{e.card_title || "Sem nome"}</p>
                      <p className="text-xs text-neutral-500">{e.phone}</p>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {e.funnel_name}
                      <br />
                      <span className="text-xs text-neutral-500">{e.stage_name}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-neutral-700">
                      {new Date(e.sent_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Estado de UI de cada mensagem da sequência — guarda a origem
// escolhida (write/quick_reply/campaign) e QUAL item foi selecionado,
// pra continuar mostrando a seleção na aba certa (bug reportado:
// escolher uma resposta rápida jogava o conteúdo de volta pra
// "Escrever" sem indicar o que tinha sido escolhido).
// Cada mensagem tem SEU PRÓPRIO tempo/gatilho, e as 3 fontes de
// conteúdo (escrever/resposta rápida/campanha) ficam TOTALMENTE
// separadas — trocar de fonte nunca mistura ou "vaza" o conteúdo de
// uma na outra (bug corrigido: antes escolher uma campanha gravava o
// texto dela no campo de escrever, e vice-versa).
export type StepUI = {
  id?: string; // preservado do backend (ver FollowupContent) — undefined = passo novo, ainda não salvo
  delay_minutes: number;
  source: MessageSource;
  writeActions: QuickReplyAction[]; // só usado/editado quando source === "write"
  selectedQuickReplyId: string | null;
  selectedCampaignId: string | null;
  // Cache da campanha já processada (imagem baixada e reenviada pro
  // bucket certo) — evita reprocessar toda vez que troca de aba e volta.
  preparedCampaignActions: QuickReplyAction[] | null;
  template_name: string | null; // API oficial (Meta) — modelo aprovado
  template_language: string | null;
  template_header_media_path: string | null;
};

export function stepUIFromContent(content?: FollowupContent): StepUI {
  return {
    id: content?.id,
    delay_minutes: content?.delay_minutes ?? 0,
    source: "write",
    writeActions: content?.actions?.length ? content.actions : [{ type: "text", text: "" }],
    selectedQuickReplyId: null,
    selectedCampaignId: null,
    preparedCampaignActions: null,
    template_name: content?.template_name ?? null,
    template_language: content?.template_language ?? null,
    template_header_media_path: content?.template_header_media_path ?? null,
  };
}

/** Conteúdo efetivo de um passo, conforme a fonte escolhida — usado na
 * hora de salvar e na validação. */
export function resolveStepActions(step: StepUI, quickReplies: QuickReply[]): QuickReplyAction[] {
  if (step.source === "quick_reply") {
    return quickReplies.find((q) => q.id === step.selectedQuickReplyId)?.actions ?? [];
  }
  if (step.source === "campaign") {
    return step.preparedCampaignActions ?? [];
  }
  return step.writeActions;
}

/** Painel único — 4 seções: Quem recebe, Quando, O que enviar, Regras. */
function FollowupEditor({
  api,
  funnels,
  rule,
  existingRuleKeys,
  templates,
  quickReplies,
  savedCampaigns,
  isMetaProvider,
  onClose,
  onSaved,
}: {
  api: Api;
  funnels: Funnel[];
  rule: FollowupRule | null;
  existingRuleKeys: Set<string>;
  templates: TemplateOption[];
  quickReplies: QuickReply[];
  savedCampaigns: SavedCampaign[];
  isMetaProvider: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !rule;
  const [name, setName] = useState(rule?.name ?? "");
  const [funnelId, setFunnelId] = useState(rule?.funnel_id ?? funnels[0]?.id ?? "");
  const [stageId, setStageId] = useState(rule?.stage_id ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [moment, setMoment] = useState<Moment>(rule?.moment ?? "entered");
  const [skipIfReplied, setSkipIfReplied] = useState(rule?.skip_if_replied ?? true);
  const [steps, setSteps] = useState<StepUI[]>(
    rule?.steps.length ? rule.steps.map(stepUIFromContent) : [stepUIFromContent()],
  );
  const [saving, setSaving] = useState(false);
  const [preparingIndex, setPreparingIndex] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");
  const selectedFunnel = funnels.find((f) => f.id === funnelId) || null;
  const stageKey = selectedFunnel && stageId ? `${funnelId}:${stageId}` : null;
  const stageAlreadyUsed = !!stageKey && existingRuleKeys.has(stageKey);
  const allowsSequence = moment === "time_in_stage";

  function changeMoment(next: Moment) {
    setMoment(next);
    if (next !== "time_in_stage" && steps.length > 1) {
      setSteps((prev) => [prev[0]]);
    }
  }

  function updateStep(i: number, patch: Partial<StepUI>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  /** Só mexe no conteúdo de "escrever" — nunca toca em resposta
   * rápida/campanha selecionada, mesmo que não seja a fonte ativa no
   * momento (trocar de fonte e voltar preserva o que já tinha escrito). */
  function updateWriteActions(i: number, actions: QuickReplyAction[]) {
    updateStep(i, { writeActions: actions });
  }
  function addStep() {
    setSteps((prev) => [...prev, stepUIFromContent()]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Trocar de fonte SÓ muda qual conteúdo fica visível/vale pra
  // salvar — nunca apaga ou mistura o que já estava em cada uma
  // (bug corrigido: antes escolher resposta rápida/campanha gravava
  // o texto delas no campo de escrever, e vice-versa).
  function pickQuickReply(i: number, qr: QuickReply) {
    updateStep(i, { source: "quick_reply", selectedQuickReplyId: qr.id, selectedCampaignId: null });
  }

  // Mesma correção já aplicada no disparo (19/09) e na 1ª versão desse
  // editor: a imagem de uma campanha vive num bucket público, diferente
  // do bucket privado que o envio de verdade usa. Baixa e reenvia pro
  // lugar certo antes de aplicar, sem tocar em writeActions.
  async function pickCampaign(i: number, c: SavedCampaign) {
    if (!c.image_path) {
      updateStep(i, {
        source: "campaign",
        selectedCampaignId: c.id,
        selectedQuickReplyId: null,
        preparedCampaignActions: [{ type: "text", text: c.body_text }],
      });
      return;
    }
    setPreparingIndex(i);
    try {
      const imgRes = await fetch(c.image_path);
      if (!imgRes.ok) throw new Error("Não consegui baixar a imagem dessa campanha.");
      const blob = await imgRes.blob();
      const mime = blob.type || "image/jpeg";
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const result = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: "campanha.jpg", mime, data_base64: dataBase64 }),
      });
      if (!result?.ok) throw new Error((result?.error as string) || "Falha ao preparar a imagem");
      updateStep(i, {
        source: "campaign",
        selectedCampaignId: c.id,
        selectedQuickReplyId: null,
        preparedCampaignActions: [
          {
            type: "image",
            path: result.path as string,
            url: result.url as string,
            mime: result.mime as string,
            filename: result.filename as string,
            caption: c.body_text,
          },
        ],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível preparar essa campanha.");
    } finally {
      setPreparingIndex(null);
    }
  }

  async function submit() {
    if (!funnelId || !stageId) {
      return toast.error(
        selectedFunnel?.mode === "label" ? "Escolhe uma lista." : "Escolhe um funil e uma etapa.",
      );
    }
    const hasMessage = (s: StepUI) =>
      isMetaProvider
        ? !!s.template_name
        : resolveStepActions(s, quickReplies).some(
            (a) => (a.type === "text" && a.text?.trim()) || a.type !== "text",
          );
    if (!steps.every(hasMessage)) {
      return toast.error(
        isMetaProvider
          ? "Escolhe um modelo aprovado em cada mensagem."
          : "Cada mensagem precisa de conteúdo.",
      );
    }
    if (isMetaProvider) {
      for (const s of steps) {
        const tpl = templates.find((t) => t.name === s.template_name);
        if (tpl?.hasImageHeader && !s.template_header_media_path) {
          return toast.error(
            `O modelo "${tpl.name}" tem imagem no cabeçalho, envie a imagem antes de salvar.`,
          );
        }
      }
    }
    setSaving(true);
    const r = await api("/api/public/extension/funnel-followup-rules", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim() || undefined,
        funnel_id: funnelId,
        stage_id: stageId,
        active,
        moment,
        skip_if_replied: skipIfReplied,
        steps: steps.map((s) => ({
          id: s.id,
          delay_minutes: s.delay_minutes,
          actions: isMetaProvider ? [] : resolveStepActions(s, quickReplies),
          template_name: isMetaProvider ? s.template_name : null,
          template_language: isMetaProvider ? "pt_BR" : null,
          template_header_media_path: isMetaProvider ? s.template_header_media_path : null,
        })),
      }),
    });
    setSaving(false);
    if (r?.ok) {
      toast.success("Follow-up salvo.");
      onSaved();
    } else {
      toast.error((r?.error as string) || "Não consegui salvar.");
    }
  }

  async function removeRule() {
    if (!rule) return;
    const ok = await confirm({
      title: "Remover esse follow-up?",
      description: "A configuração vai ser apagada.",
      confirmLabel: "Remover",
      destructive: true,
    });
    if (!ok) return;
    const r = await api(`/api/public/extension/funnel-followup-rules/${rule.id}`, {
      method: "DELETE",
    });
    if (r?.ok) {
      toast.success("Follow-up removido.");
      onSaved();
    } else {
      toast.error((r?.error as string) || "Não consegui remover.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      {dialog}
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do follow-up"
            className="h-9 max-w-xs font-medium"
          />
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-neutral-500">{active ? "Ativo" : "Pausado"}</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>

        <div className="space-y-5">
          {/* Seção 1 — Quem recebe */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Quem recebe
            </h4>
            {!isNew ? (
              <p className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {selectedFunnel?.mode === "label"
                  ? "Lista: "
                  : `${selectedFunnel?.name || "Funil"} · `}
                {selectedFunnel?.stages.find((s) => s.id === stageId)?.name || "Etapa"}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 block text-xs">
                    {selectedFunnel?.mode === "label" ? "Origem" : "Funil"}
                  </Label>
                  <Select
                    value={funnelId}
                    onValueChange={(v) => {
                      setFunnelId(v);
                      setStageId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {funnels.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.mode === "label" ? "Listas" : f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1 block text-xs">
                    {selectedFunnel?.mode === "label" ? "Lista" : "Etapa"}
                  </Label>
                  <Select value={stageId} onValueChange={setStageId} disabled={!selectedFunnel}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolhe…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedFunnel?.stages ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {isNew && stageAlreadyUsed && (
              <p className="mt-1.5 text-xs text-amber-600">
                Já existe um follow-up aí. Salvar vai substituir o que já tinha.
              </p>
            )}
          </section>

          {/* Seção 2 — Quando */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Quando
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => changeMoment("entered")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${moment === "entered" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
              >
                Assim que entrar
              </button>
              <button
                type="button"
                onClick={() => changeMoment("left_stage")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${moment === "left_stage" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
              >
                Assim que sair
              </button>
              <button
                type="button"
                onClick={() => changeMoment("time_in_stage")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${moment === "time_in_stage" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
              >
                Um tempo parado
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              {moment === "entered" &&
                "Uma mensagem, contada a partir da entrada. Pode ser na hora ou depois de um tempo."}
              {moment === "left_stage" &&
                "Uma mensagem, contada a partir do momento em que o lead sai. Pode ser na hora ou depois de um tempo."}
              {moment === "time_in_stage" &&
                "Uma sequência de mensagens, cada uma com seu próprio tempo, contadas a partir da entrada."}
            </p>
          </section>

          {/* Seção 3 — O que enviar */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {allowsSequence ? "O que enviar (sequência)" : "O que enviar"}
              </h4>
            </div>
            <div className="space-y-3">
              {steps.map((step, i) => (
                <StepEditor
                  key={i}
                  index={i}
                  step={step}
                  showTime
                  showRemove={allowsSequence && steps.length > 1}
                  isMetaProvider={isMetaProvider}
                  approvedTemplates={approvedTemplates}
                  templates={templates}
                  quickReplies={quickReplies}
                  savedCampaigns={savedCampaigns}
                  funnels={funnels}
                  preparing={preparingIndex === i}
                  api={api}
                  onSetSource={(source) => updateStep(i, { source })}
                  onDelayChange={(delay_minutes) => updateStep(i, { delay_minutes })}
                  onWriteActionsChange={(actions) => updateWriteActions(i, actions)}
                  onTemplateChange={(patch) => updateStep(i, patch)}
                  onPickQuickReply={(qr) => pickQuickReply(i, qr)}
                  onPickCampaign={(c) => void pickCampaign(i, c)}
                  onRemove={() => removeStep(i)}
                />
              ))}
            </div>
            {allowsSequence && (
              <button
                onClick={addStep}
                className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
              >
                <Plus className="h-4 w-4" /> Adicionar mensagem à sequência
              </button>
            )}
          </section>

          {/* Seção 4 — Regras */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Regras
            </h4>
            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={skipIfReplied}
                  onChange={(e) => setSkipIfReplied(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                {allowsSequence
                  ? "Se o contato responder, não envia mais nenhuma mensagem da sequência"
                  : "Não envia se o contato já respondeu"}
              </label>
            </div>
          </section>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4">
          {rule ? (
            <button
              onClick={() => void removeRule()}
              className="text-sm text-red-600 hover:underline"
            >
              Remover follow-up
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** UMA mensagem da sequência (ou a única, se moment != time_in_stage) —
 * tempo (se aplicável), origem (Escrever/Resposta rápida/Campanha), e
 * o conteúdo em si. A escolha de resposta rápida/campanha FICA visível
 * na própria aba (bug corrigido: antes sumia ao trocar pra "Escrever"
 * sem indicar o que tinha sido escolhido). */
export function StepEditor({
  index,
  step,
  showRemove,
  isMetaProvider,
  approvedTemplates,
  templates,
  quickReplies,
  savedCampaigns,
  funnels,
  preparing,
  api,
  onSetSource,
  onDelayChange,
  onWriteActionsChange,
  onTemplateChange,
  onPickQuickReply,
  onPickCampaign,
  onRemove,
}: {
  index: number;
  step: StepUI;
  showTime: boolean;
  showRemove: boolean;
  isMetaProvider: boolean;
  approvedTemplates: TemplateOption[];
  templates: TemplateOption[];
  quickReplies: QuickReply[];
  savedCampaigns: SavedCampaign[];
  funnels: Funnel[];
  preparing: boolean;
  api: Api;
  onSetSource: (s: MessageSource) => void;
  onDelayChange: (delay_minutes: number) => void;
  onWriteActionsChange: (actions: QuickReplyAction[]) => void;
  onTemplateChange: (
    patch: Partial<
      Pick<StepUI, "template_name" | "template_language" | "template_header_media_path">
    >,
  ) => void;
  onPickQuickReply: (qr: QuickReply) => void;
  onPickCampaign: (c: SavedCampaign) => void;
  onRemove: () => void;
}) {
  const { value: delayValue, unit: delayUnit } = minutesToValueUnit(step.delay_minutes);
  const [headerPreview, setHeaderPreview] = useState<string | null>(null);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadIndexRef = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const selectedQuickReply = quickReplies.find((q) => q.id === step.selectedQuickReplyId) || null;
  const selectedCampaign = savedCampaigns.find((c) => c.id === step.selectedCampaignId) || null;

  function updateAction(i: number, patch: Partial<QuickReplyAction>) {
    onWriteActionsChange(step.writeActions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function addAction(type: QuickReplyActionType) {
    onWriteActionsChange([...step.writeActions, type === "text" ? { type, text: "" } : { type }]);
  }
  function removeAction(i: number) {
    onWriteActionsChange(step.writeActions.filter((_, idx) => idx !== i));
  }

  async function handleBlockUpload(file: File) {
    const i = uploadIndexRef.current;
    if (i === null) return;
    setBusy(true);
    setError(null);
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
        reader.readAsDataURL(file);
      });
      const result = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataBase64 }),
      });
      if (!result?.ok) throw new Error((result?.error as string) || "Falha no upload");
      updateAction(i, {
        path: result.path as string,
        url: result.url as string,
        mime: result.mime as string,
        filename: result.filename as string,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      uploadIndexRef.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleHeaderFile(file: File) {
    setUploadingHeader(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
        reader.readAsDataURL(file);
      });
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || "image/jpeg",
          data_base64: dataUrl,
        }),
      });
      if (!r?.ok) {
        toast.error((r?.error as string) || "Falha ao enviar a imagem.");
        return;
      }
      onTemplateChange({ template_header_media_path: (r.path as string) || null });
      setHeaderPreview(dataUrl);
    } finally {
      setUploadingHeader(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
          <Clock className="h-3.5 w-3.5" />
          {index + 1}.
          <Input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) =>
              onDelayChange(valueUnitToMinutes(Math.max(0, Number(e.target.value) || 0), delayUnit))
            }
            className="h-7 w-16 px-2"
          />
          <Select
            value={delayUnit}
            onValueChange={(v) =>
              onDelayChange(valueUnitToMinutes(delayValue, v as "minutos" | "horas" | "dias"))
            }
          >
            <SelectTrigger className="h-7 w-24 px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minutos">minutos</SelectItem>
              <SelectItem value="horas">horas</SelectItem>
              <SelectItem value="dias">dias</SelectItem>
            </SelectContent>
          </Select>
          depois
        </div>
        {showRemove && (
          <button
            onClick={onRemove}
            className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {isMetaProvider ? (
        approvedTemplates.length === 0 ? (
          <p className="text-xs text-amber-600">
            Nenhum modelo aprovado encontrado. Cria um na aba Modelos.
          </p>
        ) : (
          <>
            <Select
              value={step.template_name || ""}
              onValueChange={(v) =>
                onTemplateChange({ template_name: v, template_header_media_path: null })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha um modelo…" />
              </SelectTrigger>
              <SelectContent>
                {approvedTemplates.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    {t.name}
                    {t.hasImageHeader ? " (tem imagem)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {templates.find((t) => t.name === step.template_name)?.hasImageHeader && (
              <div className="mt-2 rounded-lg border border-neutral-200 bg-white p-2">
                <p className="mb-1 text-xs font-medium text-neutral-600">Imagem do cabeçalho</p>
                {headerPreview && (
                  <img
                    src={headerPreview}
                    alt="Prévia"
                    className="mb-2 max-h-24 rounded-lg border border-neutral-200 object-cover"
                  />
                )}
                <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingHeader}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleHeaderFile(f);
                    }}
                    className="hidden"
                  />
                  {headerPreview ? "Trocar imagem" : "Escolher imagem"}
                </label>
                {uploadingHeader && <p className="mt-1 text-xs text-neutral-500">Enviando…</p>}
              </div>
            )}
          </>
        )
      ) : (
        <>
          <div className="mb-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onSetSource("write")}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${step.source === "write" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
            >
              Escrever
            </button>
            <button
              type="button"
              onClick={() => onSetSource("quick_reply")}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${step.source === "quick_reply" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
            >
              Resposta rápida
            </button>
            <button
              type="button"
              onClick={() => onSetSource("campaign")}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${step.source === "campaign" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
            >
              Campanha salva
            </button>
          </div>

          {step.source === "quick_reply" ? (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {quickReplies.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  Nenhuma resposta rápida cadastrada ainda.
                </p>
              ) : (
                quickReplies.map((qr) => (
                  <button
                    key={qr.id}
                    type="button"
                    onClick={() => onPickQuickReply(qr)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${selectedQuickReply?.id === qr.id ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/40"}`}
                  >
                    {qr.title}
                    {selectedQuickReply?.id === qr.id && (
                      <span className="text-xs font-semibold text-brand">Selecionada</span>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : step.source === "campaign" ? (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {savedCampaigns.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  Nenhuma campanha pronta ainda. Adota uma na aba Campanhas.
                </p>
              ) : (
                savedCampaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={preparing}
                    onClick={() => onPickCampaign(c)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-50 ${selectedCampaign?.id === c.id ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/40"}`}
                  >
                    {c.image_path && (
                      <img
                        src={c.image_path}
                        alt=""
                        className="h-8 w-12 shrink-0 rounded object-cover"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {selectedCampaign?.id === c.id && (
                      <span className="shrink-0 text-xs font-semibold text-brand">Selecionada</span>
                    )}
                  </button>
                ))
              )}
              {preparing && <p className="text-xs text-neutral-500">Preparando imagem…</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {step.writeActions.map((action, i) => (
                <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-neutral-700">
                      {i + 1}. {actionLabel(action.type)}
                    </span>
                    {step.writeActions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeAction(i)}
                        className="text-xs text-red-600"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  {action.type === "text" ? (
                    <Textarea
                      value={action.text ?? ""}
                      onChange={(e) => updateAction(i, { text: e.target.value })}
                      rows={2}
                      placeholder="Escreva esse bloco da mensagem…"
                      className="mt-2"
                    />
                  ) : action.type === "funnel_add" || action.type === "funnel_remove" ? (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <select
                        value={action.funnel_id ?? ""}
                        onChange={(e) =>
                          updateAction(i, {
                            funnel_id: e.target.value || undefined,
                            stage_id: undefined,
                          })
                        }
                        className={inputCls}
                      >
                        <option value="">Escolha o funil/lista</option>
                        {funnels.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.mode === "label" ? "Listas" : f.name}
                          </option>
                        ))}
                      </select>
                      {action.type === "funnel_add" && (
                        <select
                          value={action.stage_id ?? ""}
                          onChange={(e) =>
                            updateAction(i, { stage_id: e.target.value || undefined })
                          }
                          className={inputCls}
                        >
                          <option value="">Escolha a etapa/lista</option>
                          {(funnels.find((f) => f.id === action.funnel_id)?.stages ?? []).map(
                            (s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ),
                          )}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          uploadIndexRef.current = i;
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
                        onChange={(e) => updateAction(i, { caption: e.target.value })}
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
                    className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-100"
                  >
                    + {actionLabel(type)}
                  </button>
                ))}
              </div>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleBlockUpload(f);
                }}
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
