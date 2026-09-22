// Aba "Follow-up": sequência de mensagens programadas por etapa de
// funil OU lista. O gatilho pode ser "assim que entrar", "assim que
// sair" ou "tempo parado" — configurado num painel único (não mais
// dividido em telas separadas), pedido explícito do usuário (22/09):
// "a etapa que você vai escolher é uma etapa que fica DENTRO da
// configuração do follow-up", não um passo prévio separado.
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
import { Plus, Trash2, Clock, FileText, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import type { Funnel } from "@/lib/funnels";

type Api = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

type FollowupStep = {
  id?: string;
  delay_minutes: number;
  actions: Array<{ type: "text"; text: string }>;
  template_name: string | null;
  template_language: string | null;
  template_header_media_path: string | null;
};

type FollowupRule = {
  id: string;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  trigger_type: "time_in_stage" | "left_stage";
  max_messages_per_contact: number | null;
  skip_if_replied: boolean;
  steps: FollowupStep[];
};

type TemplateOption = { name: string; language: string; status: string; hasImageHeader: boolean };

// Momento de UI (3 opções, como o usuário descreveu) — mapeia pros 2
// trigger_type reais do backend: "immediate" e "time_in_stage" usam o
// mesmo trigger_type "time_in_stage", só muda se o campo de tempo por
// passo fica visível (immediate esconde, sempre 0).
type Moment = "immediate" | "time_in_stage" | "left_stage";

function momentFromRule(rule: FollowupRule | null): Moment {
  if (!rule) return "immediate";
  if (rule.trigger_type === "left_stage") return "left_stage";
  const allImmediate = rule.steps.every((s) => s.delay_minutes === 0);
  return allImmediate ? "immediate" : "time_in_stage";
}

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

function emptyStep(delayMinutes = 60 * 24 * 3): FollowupStep {
  return {
    delay_minutes: delayMinutes,
    actions: [{ type: "text", text: "" }],
    template_name: null,
    template_language: null,
    template_header_media_path: null,
  };
}

export function FollowupView({ api }: { api: Api }) {
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [rules, setRules] = useState<FollowupRule[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | "new" | null>(null);
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
  // "label") mostram "Lista: X" em vez de "Funil > Etapa".
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

  function momentLabel(rule: FollowupRule): string {
    const m = momentFromRule(rule);
    if (m === "immediate") return "Assim que entrar";
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
            const stepCount = rule.steps.length;
            return (
              <button
                key={rule.id}
                onClick={() => setEditingRuleId(rule.id)}
                className="flex flex-col gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-brand/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-neutral-900">
                    {isList ? "Lista: " : ""}
                    {stageName}
                  </p>
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${rule.active ? "bg-emerald-500" : "bg-neutral-300"}`}
                  />
                </div>
                {!isList && <p className="text-xs text-neutral-500">{funnelName}</p>}
                <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {momentLabel(rule)}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                    {stepCount} passo{stepCount === 1 ? "" : "s"}
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

/** Painel único de configuração — as 4 seções pedidas pelo usuário
 * (22/09): Quem recebe, Quando, O que, Regras. Tudo no mesmo
 * retângulo, sem telas separadas. */
function FollowupEditor({
  api,
  funnels,
  rule,
  existingRuleKeys,
  templates,
  isMetaProvider,
  onClose,
  onSaved,
}: {
  api: Api;
  funnels: Funnel[];
  rule: FollowupRule | null;
  existingRuleKeys: Set<string>;
  templates: TemplateOption[];
  isMetaProvider: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !rule;
  const [funnelId, setFunnelId] = useState(rule?.funnel_id ?? funnels[0]?.id ?? "");
  const [stageId, setStageId] = useState(rule?.stage_id ?? "");
  const [active, setActive] = useState(rule?.active ?? true);
  const [moment, setMoment] = useState<Moment>(momentFromRule(rule));
  const [maxMessages, setMaxMessages] = useState<number | "">(rule?.max_messages_per_contact ?? "");
  const [skipIfReplied, setSkipIfReplied] = useState(rule?.skip_if_replied ?? true);
  const [steps, setSteps] = useState<FollowupStep[]>(
    rule?.steps.length ? rule.steps : [emptyStep(0)],
  );
  const [saving, setSaving] = useState(false);
  const [headerPreviews, setHeaderPreviews] = useState<Record<number, string>>({});
  const [uploadingHeaderIndex, setUploadingHeaderIndex] = useState<number | null>(null);
  const { confirm, dialog } = useConfirm();

  const approvedTemplates = templates.filter((t) => t.status === "APPROVED");
  const selectedFunnel = funnels.find((f) => f.id === funnelId) || null;
  const stageKey = selectedFunnel && stageId ? `${funnelId}:${stageId}` : null;
  const stageAlreadyUsed = !!stageKey && existingRuleKeys.has(stageKey);

  function changeMoment(next: Moment) {
    setMoment(next);
    if (next === "immediate") {
      // Assim que entrar: sempre 0, sem sentido mostrar/editar o campo
      // de tempo por passo — força todos os passos existentes pra 0.
      setSteps((prev) => prev.map((s) => ({ ...s, delay_minutes: 0 })));
    }
  }

  function updateStep(i: number, patch: Partial<FollowupStep>) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, emptyStep(moment === "immediate" ? 0 : undefined)]);
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
    if (!funnelId || !stageId) {
      return toast.error(
        selectedFunnel?.mode === "label" ? "Escolhe uma lista." : "Escolhe um funil e uma etapa.",
      );
    }
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
        trigger_type: moment === "left_stage" ? "left_stage" : "time_in_stage",
        max_messages_per_contact: maxMessages === "" ? null : maxMessages,
        skip_if_replied: skipIfReplied,
        steps: cleaned.map((s) => ({
          delay_minutes: moment === "immediate" ? 0 : s.delay_minutes,
          actions: isMetaProvider ? [] : [{ type: "text", text: s.actions[0].text.trim() }],
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
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">
            {isNew ? "Novo follow-up" : "Editar follow-up"}
          </h3>
          <div className="flex items-center gap-2">
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
                Já existe um follow-up aí — salvar vai substituir o que já tinha.
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
                onClick={() => changeMoment("immediate")}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold ${moment === "immediate" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
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
          </section>

          {/* Seção 3 — O que (mensagem) */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              O que enviar
            </h4>
            {isMetaProvider && (
              <p className="mb-2 text-xs text-neutral-500">
                Seu número está conectado via Meta, então cada passo precisa de um modelo aprovado.
              </p>
            )}
            <div className="space-y-3">
              {steps.map((step, i) => {
                const { value, unit } = minutesToValueUnit(step.delay_minutes);
                return (
                  <div key={i} className="rounded-xl border border-neutral-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                        <Clock className="h-3.5 w-3.5" /> Passo {i + 1}
                        {moment !== "immediate" && (
                          <>
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
                                updateStep(i, {
                                  delay_minutes: valueUnitToMinutes(
                                    value,
                                    v as "minutos" | "horas" | "dias",
                                  ),
                                })
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
                          </>
                        )}
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
                  </div>
                );
              })}
            </div>
            <button
              onClick={addStep}
              className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
            >
              <Plus className="h-4 w-4" /> Adicionar passo
            </button>
          </section>

          {/* Seção 4 — Regras */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Regras
            </h4>
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={skipIfReplied}
                  onChange={(e) => setSkipIfReplied(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-300"
                />
                Pular os próximos passos se o contato já respondeu
              </label>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-neutral-700">Limite de mensagens por contato</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="Sem limite"
                  value={maxMessages}
                  onChange={(e) =>
                    setMaxMessages(e.target.value === "" ? "" : Math.max(1, Number(e.target.value)))
                  }
                  className="h-8 w-28"
                />
              </div>
            </div>
          </section>
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
