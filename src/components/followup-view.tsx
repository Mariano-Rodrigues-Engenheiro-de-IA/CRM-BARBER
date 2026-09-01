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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Clock, ChevronRight } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import type { Funnel } from "@/lib/funnels";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type FollowupStep = {
  id?: string;
  delay_minutes: number;
  actions: Array<{ type: "text"; text: string }>;
  template_name: string | null;
  template_language: string | null;
  skip_if_replied: boolean;
};

type FollowupRule = {
  id: string;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  steps: FollowupStep[];
};

type TemplateOption = { name: string; language: string; status: string };

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
  return { delay_minutes: 60 * 24 * 3, actions: [{ type: "text", text: "" }], template_name: null, template_language: null, skip_if_replied: true };
}

export function FollowupView({ api }: { api: Api }) {
  const [funnels, setFunnels] = useState<Funnel[] | null>(null);
  const [funnelId, setFunnelId] = useState<string>("");
  const [rules, setRules] = useState<FollowupRule[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);

  useEffect(() => {
    api("/api/public/extension/funnels").then((r) => {
      if (!r?.ok) return;
      const list = ((r.funnels as Funnel[]) || []).filter((f) => f.mode !== "label");
      setFunnels(list);
      if (list.length) setFunnelId((cur) => cur || list[0].id);
    });
    api("/api/public/extension/whatsapp/status").then((st) => {
      if (st?.ok && st.connection) {
        setIsMetaProvider((st.connection as { provider?: string }).provider === "meta");
      }
    });
    api("/api/public/extension/whatsapp/templates")
      .then((t) => {
        if (!t?.ok) return;
        setTemplates(
          ((t.templates as Array<{ name: string; language: string; status: string }>) || []).map((tpl) => ({
            name: tpl.name,
            language: tpl.language,
            status: tpl.status,
          })),
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadRules(fId: string) {
    const r = await api(`/api/public/extension/funnel-followup-rules?funnel_id=${fId}`);
    if (r?.ok) setRules((r.rules as FollowupRule[]) || []);
  }

  useEffect(() => {
    if (funnelId) void reloadRules(funnelId);
  }, [funnelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeFunnel = funnels?.find((f) => f.id === funnelId) || null;
  const editingStage = activeFunnel?.stages.find((s) => s.id === editingStageId) || null;
  const editingRule = editingStageId ? rules.find((r) => r.stage_id === editingStageId) || null : null;

  return (
    <div className="space-y-4">
      {!funnels ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : funnels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm text-neutral-500">Nenhum funil criado ainda. Cria um na aba Funis de Vendas primeiro.</p>
        </div>
      ) : (
        <>
          <div className="max-w-xs">
            <Label>Funil</Label>
            <Select value={funnelId} onValueChange={setFunnelId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {funnels.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeFunnel && (
            <div className="space-y-2">
              {activeFunnel.stages.length === 0 ? (
                <p className="text-sm text-neutral-500">Esse funil ainda não tem etapas.</p>
              ) : (
                activeFunnel.stages.map((stage) => {
                  const rule = rules.find((r) => r.stage_id === stage.id);
                  const stepCount = rule?.steps.length || 0;
                  return (
                    <button
                      key={stage.id}
                      onClick={() => setEditingStageId(stage.id)}
                      className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm transition hover:border-brand/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-900">{stage.name}</p>
                        <p className="text-xs text-neutral-500">
                          {stepCount === 0
                            ? "Sem follow-up configurado"
                            : `${stepCount} passo${stepCount === 1 ? "" : "s"} configurado${stepCount === 1 ? "" : "s"}${rule && !rule.active ? ", pausado" : ""}`}
                        </p>
                      </div>
                      {stepCount > 0 && (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${rule?.active ? "bg-emerald-500" : "bg-neutral-300"}`}
                        />
                      )}
                      <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
                    </button>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {editingStage && activeFunnel && (
        <StageFollowupEditor
          api={api}
          funnelId={activeFunnel.id}
          stageName={editingStage.name}
          stageId={editingStage.id}
          rule={editingRule}
          templates={templates}
          isMetaProvider={isMetaProvider}
          onClose={() => setEditingStageId(null)}
          onSaved={() => {
            setEditingStageId(null);
            void reloadRules(activeFunnel.id);
          }}
        />
      )}
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
  const [steps, setSteps] = useState<FollowupStep[]>(rule?.steps.length ? rule.steps : [emptyStep()]);
  const [saving, setSaving] = useState(false);
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

  async function submit() {
    const cleaned = steps.filter((s) => (isMetaProvider ? !!s.template_name : s.actions[0]?.text?.trim()));
    if (!cleaned.length) {
      return toast.error(isMetaProvider ? "Escolhe um modelo em pelo menos um passo." : "Escreve pelo menos uma mensagem.");
    }
    setSaving(true);
    const r = await api("/api/public/extension/funnel-followup-rules", {
      method: "POST",
      body: JSON.stringify({
        funnel_id: funnelId,
        stage_id: stageId,
        active,
        steps: cleaned.map((s) => ({
          delay_minutes: s.delay_minutes,
          actions: isMetaProvider ? [] : [{ type: "text", text: s.actions[0].text.trim() }],
          template_name: isMetaProvider ? s.template_name : null,
          template_language: isMetaProvider ? "pt_BR" : null,
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
    const r = await api(`/api/public/extension/funnel-followup-rules/${rule.id}`, { method: "DELETE" });
    if (r?.ok) {
      toast.success("Follow-up removido.");
      onSaved();
    } else {
      toast.error((r?.error as string) || "Não consegui remover.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
                        updateStep(i, { delay_minutes: valueUnitToMinutes(Math.max(0, Number(e.target.value) || 0), unit) })
                      }
                      className="h-7 w-16 px-2"
                    />
                    <Select value={unit} onValueChange={(v) => updateStep(i, { delay_minutes: valueUnitToMinutes(value, v as any) })}>
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
                    <button onClick={() => removeStep(i)} className="rounded-md p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600">
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
                    <Select value={step.template_name || ""} onValueChange={(v) => updateStep(i, { template_name: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha um modelo…" />
                      </SelectTrigger>
                      <SelectContent>
                        {approvedTemplates.map((t) => (
                          <SelectItem key={t.name} value={t.name}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )
                ) : (
                  <Textarea
                    value={step.actions[0]?.text || ""}
                    onChange={(e) => updateStep(i, { actions: [{ type: "text", text: e.target.value }] })}
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

        <button
          onClick={addStep}
          className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          <Plus className="h-4 w-4" /> Adicionar passo
        </button>

        <div className="mt-5 flex items-center justify-between border-t border-neutral-100 pt-4">
          {rule ? (
            <button onClick={() => void removeRule()} className="flex items-center gap-1.5 text-sm text-red-600 hover:underline">
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
