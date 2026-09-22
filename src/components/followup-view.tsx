// Aba "Follow-up": sequência de mensagens programadas por ETAPA de funil.
//
// O tempo de cada passo conta a partir de quando o lead entrou na etapa
// atual (funnel_cards.stage_entered_at). Sai da etapa, a sequência
// reseta. Pré-configurado pelo usuário; nenhuma IA envolvida por enquanto.
import { useEffect, useState } from "react";
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
import { Plus, Trash2, Clock, ChevronRight, FileText, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import type { Funnel } from "@/lib/funnels";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type FollowupStep = {
  id?: string;
  delay_minutes: number;
  actions: Array<{ type: "text"; text: string }>;
  template_name: string | null;
  template_language: string | null;
  template_header_media_path: string | null;
  skip_if_replied: boolean;
};

type FollowupRule = {
  id: string;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  trigger_type: "time_in_stage" | "left_stage";
  max_messages_per_contact: number | null;
  steps: FollowupStep[];
};

type TemplateOption = { name: string; language: string; status: string; hasImageHeader: boolean };

function minutesToValueUnit(min: number): { value: number; unit: "minutos" | "horas" | "dias" } {
  if (min % (60 * 24) === 0 && min > 0) return { value: min / (60 * 24), unit: "dias" };
  if (min % 60 === 0 && min > 0) return { value: min / 60, unit: "horas" };
  return { value: min, unit: "minutos" };
}
function valueUnitToMinutes(value: number, unit: "minutos" | "horas" | "dias") {
  if (unit === "dias") return value * 60 * 24;
  if (unit === "horas") return value * 60;
  return value;
}

function emptyStep(): FollowupStep {
  return {
    delay_minutes: 60 * 24 * 3,
    actions: [{ type: "text", text: "" }],
    template_name: null,
    template_language: null,
    template_header_media_path: null,
    skip_if_replied: true,
  };
}

export function FollowupView({ api }: { api: Api }) {
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [rules, setRules] = useState<FollowupRule[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [editingRuleKey, setEditingRuleKey] = useState<{
    funnelId: string;
    stageId: string;
  } | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [showReport, setShowReport] = useState(false);

  async function reloadAll() {
    const [f, r] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/funnel-followup-rules"),
    ]);
    if (f?.ok) setFunnels((f.funnels as Funnel[]) || []);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nome de exibição pra cada (funil, etapa) — funis "Listas" (mode
  // "label") mostram "Lista: X" em vez de "Funil > Etapa", já que pro
  // usuário são conceitos diferentes mesmo usando a mesma engrenagem
  // por trás.
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

  const editingLabel = editingRuleKey
    ? labelFor(editingRuleKey.funnelId, editingRuleKey.stageId)
    : null;
  const editingRule = editingRuleKey
    ? rules.find(
        (r) => r.funnel_id === editingRuleKey.funnelId && r.stage_id === editingRuleKey.stageId,
      ) || null
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button size="sm" onClick={() => setShowPicker(true)} className="gap-1.5">
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
        <div className="space-y-2">
          {rules.map((rule) => {
            const { funnelName, stageName, isList } = labelFor(rule.funnel_id, rule.stage_id);
            const stepCount = rule.steps.length;
            return (
              <button
                key={rule.id}
                onClick={() =>
                  setEditingRuleKey({ funnelId: rule.funnel_id, stageId: rule.stage_id })
                }
                className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-brand/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900">
                    {isList ? "Lista: " : ""}
                    {stageName}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {isList ? "" : `${funnelName} · `}
                    {stepCount} passo{stepCount === 1 ? "" : "s"} configurado
                    {stepCount === 1 ? "" : "s"}
                    {!rule.active ? ", pausado" : ""}
                  </p>
                </div>
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${rule.active ? "bg-emerald-500" : "bg-neutral-300"}`}
                />
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
              </button>
            );
          })}
        </div>
      )}

      {showPicker && funnels && (
        <StageAndFunnelPicker
          funnels={funnels}
          existingRuleKeys={new Set(rules.map((r) => `${r.funnel_id}:${r.stage_id}`))}
          onPick={(funnelId, stageId) => {
            setShowPicker(false);
            setEditingRuleKey({ funnelId, stageId });
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {editingRuleKey && editingLabel && (
        <StageFollowupEditor
          api={api}
          funnelId={editingRuleKey.funnelId}
          stageName={(editingLabel.isList ? "Lista: " : "") + editingLabel.stageName}
          stageId={editingRuleKey.stageId}
          rule={editingRule}
          templates={templates}
          isMetaProvider={isMetaProvider}
          onClose={() => setEditingRuleKey(null)}
          onSaved={() => {
            setEditingRuleKey(null);
            void reloadAll();
          }}
        />
      )}

      {showReport && <FollowupReportModal api={api} onClose={() => setShowReport(false)} />}
    </div>
  );
}

/** Escolha de Funil (ou Lista) + Etapa antes de criar um follow-up novo
 * — separado do fluxo antigo (clicar direto na etapa numa lista fixa),
 * já que agora a tela principal mostra os follow-ups, não as etapas. */
function StageAndFunnelPicker({
  funnels,
  existingRuleKeys,
  onPick,
  onClose,
}: {
  funnels: Funnel[];
  existingRuleKeys: Set<string>;
  onPick: (funnelId: string, stageId: string) => void;
  onClose: () => void;
}) {
  const [funnelId, setFunnelId] = useState(funnels[0]?.id || "");
  const funnel = funnels.find((f) => f.id === funnelId) || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-neutral-900">Novo follow-up</h3>
        <div className="space-y-3">
          <div>
            <Label>{funnel?.mode === "label" ? "Origem" : "Funil"}</Label>
            <Select value={funnelId} onValueChange={setFunnelId}>
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
          {funnel && (
            <div>
              <Label>{funnel.mode === "label" ? "Lista" : "Etapa"}</Label>
              <div className="mt-1 space-y-1.5">
                {funnel.stages.length === 0 ? (
                  <p className="text-sm text-neutral-500">
                    {funnel.mode === "label"
                      ? "Nenhuma lista criada ainda."
                      : "Esse funil ainda não tem etapas."}
                  </p>
                ) : (
                  funnel.stages.map((stage) => {
                    const already = existingRuleKeys.has(`${funnel.id}:${stage.id}`);
                    return (
                      <button
                        key={stage.id}
                        onClick={() => onPick(funnel.id, stage.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm hover:border-brand/40"
                      >
                        {stage.name}
                        {already && (
                          <span className="text-xs text-neutral-400">já configurado</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
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
              Todas as mensagens já enviadas pela sequência, mais recentes primeiro.
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

function StageFollowupEditor({
  api,
  funnelId,
  stageId,
  stageName,
  rule,
  templates,
  isMetaProvider,
  onClose,
  onSaved,
}: {
  api: Api;
  funnelId: string;
  stageId: string;
  stageName: string;
  rule: FollowupRule | null;
  templates: TemplateOption[];
  isMetaProvider: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [active, setActive] = useState(rule?.active ?? true);
  const [triggerType, setTriggerType] = useState<"time_in_stage" | "left_stage">(
    rule?.trigger_type ?? "time_in_stage",
  );
  const [maxMessages, setMaxMessages] = useState<number | "">(rule?.max_messages_per_contact ?? "");
  const [steps, setSteps] = useState<FollowupStep[]>(
    rule?.steps.length ? rule.steps : [emptyStep()],
  );
  const [saving, setSaving] = useState(false);
  const [headerPreviews, setHeaderPreviews] = useState<Record<number, string>>({});
  const [uploadingHeaderIndex, setUploadingHeaderIndex] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");

  function updateStep(i: number, patch: Partial<FollowupStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep()]);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleStepHeaderFile(i: number, file: File) {
    setUploadingHeaderIndex(i);
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
      updateStep(i, { template_header_media_path: (r.path as string) || null });
      setHeaderPreviews((prev) => ({ ...prev, [i]: dataUrl }));
    } finally {
      setUploadingHeaderIndex(null);
    }
  }

  async function submit() {
    const cleaned = steps.filter((s) =>
      isMetaProvider ? !!s.template_name : s.actions[0]?.text?.trim(),
    );
    if (!cleaned.length) {
      return toast.error(
        isMetaProvider
          ? "Escolhe um modelo em pelo menos um passo."
          : "Escreve pelo menos uma mensagem.",
      );
    }
    if (isMetaProvider) {
      for (const s of cleaned) {
        const tpl = templates.find((t) => t.name === s.template_name);
        if (tpl?.hasImageHeader && !s.template_header_media_path) {
          return toast.error(
            `O modelo do passo com "${tpl.name}" tem imagem no cabeçalho, envie a imagem antes de salvar.`,
          );
        }
      }
    }
    setSaving(true);
    const r = await api("/api/public/extension/funnel-followup-rules", {
      method: "POST",
      body: JSON.stringify({
        funnel_id: funnelId,
        stage_id: stageId,
        active,
        trigger_type: triggerType,
        max_messages_per_contact: maxMessages === "" ? null : maxMessages,
        steps: cleaned.map((s) => ({
          delay_minutes: s.delay_minutes,
          actions: isMetaProvider ? [] : [{ type: "text", text: s.actions[0].text.trim() }],
          template_name: isMetaProvider ? s.template_name : null,
          template_language: isMetaProvider ? "pt_BR" : null,
          template_header_media_path: isMetaProvider ? s.template_header_media_path : null,
          skip_if_replied: s.skip_if_replied,
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
      title: "Remover follow-up dessa etapa?",
      description: "Todos os passos configurados vão ser apagados.",
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
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">Follow-up, {stageName}</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">{active ? "Ativo" : "Pausado"}</span>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <p className="mb-4 text-xs text-neutral-500">
          {isMetaProvider
            ? "Seu número está conectado via Meta, então cada passo precisa de um modelo aprovado."
            : "O tempo de cada passo conta a partir de quando o lead entrou nessa etapa."}
        </p>

        <div className="mb-4 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div>
            <Label className="mb-1.5 block text-xs">Quando disparar</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTriggerType("time_in_stage")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${triggerType === "time_in_stage" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
              >
                Tempo parado(a) aqui
              </button>
              <button
                type="button"
                onClick={() => setTriggerType("left_stage")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${triggerType === "left_stage" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
              >
                Assim que sair daqui
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              {triggerType === "time_in_stage"
                ? "Cada passo conta a partir da entrada. Coloca 0 minutos num passo pra disparar assim que entrar."
                : "Cada passo conta a partir do momento em que o lead sai dessa etapa/lista, pra qualquer lugar que vá."}
            </p>
          </div>
          <div>
            <Label className="mb-1.5 block text-xs">
              Limite de mensagens por contato (opcional)
            </Label>
            <Input
              type="number"
              min={1}
              placeholder="Sem limite"
              value={maxMessages}
              onChange={(e) =>
                setMaxMessages(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))
              }
              className="h-8 w-32"
            />
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => {
            const { value, unit } = minutesToValueUnit(step.delay_minutes);
            return (
              <div key={i} className="rounded-xl border border-neutral-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                    <Clock className="h-3.5 w-3.5" /> Passo {i + 1}
                    <Input
                      type="number"
                      min={0}
                      value={value}
                      onChange={(e) =>
                        updateStep(i, {
                          delay_minutes: valueUnitToMinutes(
                            Math.max(0, Number(e.target.value) || 0),
                            unit,
                          ),
                        })
                      }
                      className="h-7 w-16 px-2"
                    />
                    <Select
                      value={unit}
                      onValueChange={(v) =>
                        updateStep(i, { delay_minutes: valueUnitToMinutes(value, v as any) })
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
                    parado(a) aqui
                  </div>
                  {steps.length > 1 && (
                    <button
                      onClick={() => removeStep(i)}
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
                          updateStep(i, { template_name: v, template_header_media_path: null })
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
                          <p className="mb-1 text-xs font-medium text-neutral-600">
                            Imagem do cabeçalho
                          </p>
                          {headerPreviews[i] && (
                            <img
                              src={headerPreviews[i]}
                              alt="Prévia"
                              className="mb-2 max-h-24 rounded-lg border border-neutral-200 object-cover"
                            />
                          )}
                          <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-600 hover:border-brand">
                            <input
                              type="file"
                              accept="image/*"
                              disabled={uploadingHeaderIndex === i}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void handleStepHeaderFile(i, f);
                              }}
                              className="hidden"
                            />
                            {headerPreviews[i] ? "Trocar imagem" : "Escolher imagem"}
                          </label>
                          {uploadingHeaderIndex === i && (
                            <p className="mt-1 text-xs text-neutral-500">Enviando…</p>
                          )}
                        </div>
                      )}
                    </>
                  )
                ) : (
                  <Textarea
                    value={step.actions[0]?.text || ""}
                    onChange={(e) =>
                      updateStep(i, { actions: [{ type: "text", text: e.target.value }] })
                    }
                    rows={2}
                    placeholder="Mensagem que será enviada…"
                  />
                )}

                <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600">
                  <input
                    type="checkbox"
                    checked={step.skip_if_replied}
                    onChange={(e) => updateStep(i, { skip_if_replied: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-neutral-300"
                  />
                  Pular se o cliente já respondeu depois de entrar nessa etapa
                </label>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center gap-4">
          <button
            onClick={addStep}
            className="flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
          >
            <Plus className="h-4 w-4" /> Adicionar passo
          </button>
          <button
            onClick={() => setSteps((prev) => [...prev, { ...emptyStep(), delay_minutes: 0 }])}
            className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 hover:underline"
          >
            <Plus className="h-4 w-4" />
            {triggerType === "left_stage" ? "Passo assim que sair" : "Passo assim que entrar"}
          </button>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4">
          {rule ? (
            <button
              onClick={() => void removeRule()}
              className="flex items-center gap-1.5 text-sm text-red-600 hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remover follow-up
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
