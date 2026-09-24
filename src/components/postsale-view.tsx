// Aba "Pós-venda / Retorno" — tela dedicada e simples (não o construtor
// genérico de Follow-up): exatamente 2 mensagens configuráveis —
// Pós-venda e Retorno — disparadas quando o cliente é marcado como
// atendido (ícone de tesoura na conversa, ver funnels-view.tsx).
//
// Por baixo é uma funnel_followup_rule normal (moment: "time_in_stage",
// 2 passos), presa ao funil especial "Pós-venda" (mode "postsale",
// auto-criado na primeira marcação de atendimento) — mesma engrenagem
// de disparo, avaliação e limite construída e refinada em Follow-up.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { Funnel } from "@/lib/funnels";
import type { QuickReply } from "@/lib/quick-replies";
import type { SavedCampaign } from "@/components/campaigns-marketplace-view";
import {
  StepEditor,
  stepUIFromContent,
  resolveStepActions,
  minutesToValueUnit,
  type Api,
  type TemplateOption,
  type StepUI,
  type FollowupContent,
} from "@/components/followup-view";

type PostsaleRule = {
  id: string;
  funnel_id: string;
  stage_id: string;
  active: boolean;
  badge_period_days: number;
  steps: FollowupContent[];
};

// Cache entre navegações: voltar pra Pós-venda depois de já ter visitado
// não mostra mais a tela de carregamento do zero - mostra o funil já
// buscado antes na hora, e atualiza por trás. Achado real na varredura de
// performance do Mariano (aba "carregando" toda vez que abria, agravado
// aqui por uma chamada extra bloqueante de "garantir que o funil existe"
// rodando antes de toda visita, não só a primeira).
let postsaleCache: Funnel | null | undefined;

export function PostsaleView({ api }: { api: Api }) {
  const [funnel, setFunnel] = useState<Funnel | null | undefined>(postsaleCache); // undefined = carregando
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [active, setActive] = useState(true);
  const [postSaleStep, setPostSaleStep] = useState<StepUI>(stepUIFromContent());
  const [returnStep, setReturnStep] = useState<StepUI>(stepUIFromContent());
  const [saving, setSaving] = useState(false);
  const [preparingIndex, setPreparingIndex] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<"postsale" | "return" | null>(null);
  const [showReport, setShowReport] = useState(false);

  async function reloadAll() {
    // Garante o funil especial existe ANTES de qualquer coisa — a
    // configuração precisa funcionar mesmo que ninguém nunca tenha
    // marcado um atendimento ainda (pedido explícito do usuário, 22/09:
    // "como é que ele vai configurar depois, sendo que quando o cara
    // marcar o atendimento, o cliente já tem que receber o pós-venda").
    await api("/api/public/extension/postsale-ensure", { method: "POST" });

    const [f, t, q, c, st] = await Promise.all([
      api("/api/public/extension/funnels"),
      api("/api/public/extension/whatsapp/templates"),
      api("/api/public/extension/quick-replies"),
      api("/api/public/extension/campaigns/catalog"),
      api("/api/public/extension/whatsapp/status"),
    ]);
    const postsaleFunnel = f?.ok
      ? ((f.funnels as Funnel[]) || []).find((fn) => fn.mode === "postsale") || null
      : null;
    setFunnel(postsaleFunnel);
    postsaleCache = postsaleFunnel;

    if (t?.ok) {
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
            (comp) =>
              String(comp.type).toUpperCase() === "HEADER" &&
              String(comp.format).toUpperCase() === "IMAGE",
          ),
        })),
      );
    }
    if (q?.ok) setQuickReplies((q.quick_replies as QuickReply[]) || []);
    if (c?.ok) {
      const all = (c.saved as SavedCampaign[]) || [];
      setSavedCampaigns(all.filter((s) => s.status === "approved"));
    }
    if (st?.ok && st.connection) {
      setIsMetaProvider((st.connection as { provider?: string }).provider === "meta");
    }

    if (postsaleFunnel) {
      const r = await api(
        `/api/public/extension/funnel-followup-rules?funnel_id=${postsaleFunnel.id}`,
      );
      const found = r?.ok ? ((r.rules as PostsaleRule[]) || [])[0] || null : null;
      setActive(found?.active ?? true);
      setPostSaleStep(stepUIFromContent(found?.steps[0]));
      setReturnStep(stepUIFromContent(found?.steps[1]));
    }
  }

  useEffect(() => {
    void reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templateOptions = templates.filter((t) => t.status === "APPROVED");

  function pickQuickReplyFor(setStep: typeof setPostSaleStep, qr: QuickReply) {
    setStep((prev) => ({
      ...prev,
      source: "quick_reply",
      selectedQuickReplyId: qr.id,
      selectedCampaignId: null,
    }));
  }

  async function pickCampaignFor(
    setStep: typeof setPostSaleStep,
    stepIndex: number,
    c: SavedCampaign,
  ) {
    if (!c.image_path) {
      setStep((prev) => ({
        ...prev,
        source: "campaign",
        selectedCampaignId: c.id,
        selectedQuickReplyId: null,
        preparedCampaignActions: [{ type: "text", text: c.body_text }],
      }));
      return;
    }
    setPreparingIndex(stepIndex);
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
      setStep((prev) => ({
        ...prev,
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
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível preparar essa campanha.");
    } finally {
      setPreparingIndex(null);
    }
  }

  async function submit(opts?: { onSuccess?: () => void; overrideActive?: boolean }) {
    if (!funnel) {
      toast.error("Não consegui preparar a aba de pós-venda. Tenta recarregar a página.");
      return;
    }
    const stage = funnel.stages[0];
    if (!stage) {
      toast.error("Etapa de pós-venda não encontrada.");
      return;
    }
    const hasMessage = (s: StepUI) =>
      isMetaProvider
        ? !!s.template_name
        : resolveStepActions(s, quickReplies).some(
            (a) => (a.type === "text" && a.text?.trim()) || a.type !== "text",
          );
    if (!hasMessage(postSaleStep) || !hasMessage(returnStep)) {
      toast.error(
        isMetaProvider
          ? "Escolhe um modelo aprovado nas duas mensagens."
          : "As duas mensagens (pós-venda e retorno) precisam de conteúdo.",
      );
      return;
    }
    setSaving(true);
    const r = await api("/api/public/extension/funnel-followup-rules", {
      method: "POST",
      body: JSON.stringify({
        name: "Pós-venda / Retorno",
        funnel_id: funnel.id,
        stage_id: stage.id,
        active: opts?.overrideActive ?? active,
        moment: "time_in_stage",
        skip_if_replied: false,
        badge_period_days: 30,
        steps: [postSaleStep, returnStep].map((s) => ({
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
      toast.success("Pós-venda salvo.");
      void reloadAll();
      opts?.onSuccess?.();
    } else {
      toast.error((r?.error as string) || "Não consegui salvar.");
    }
  }

  async function saveActiveToggle(next: boolean) {
    setActive(next);
    await submit({ overrideActive: next });
  }

  if (funnel === undefined) {
    return <p className="text-sm text-neutral-500">Carregando…</p>;
  }

  if (!funnel) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
        <p className="text-sm text-neutral-500">
          Não consegui preparar a aba de pós-venda. Tenta recarregar a página.
        </p>
      </div>
    );
  }

  function summarizeStep(step: StepUI): { time: string; content: string } {
    const { value, unit } = minutesToValueUnit(step.delay_minutes);
    const time = value === 0 ? "Na hora" : `${value} ${unit} depois`;
    if (isMetaProvider) {
      return {
        time,
        content: step.template_name ? `Modelo: ${step.template_name}` : "Nenhum modelo escolhido",
      };
    }
    if (step.source === "quick_reply") {
      const qr = quickReplies.find((q) => q.id === step.selectedQuickReplyId);
      return { time, content: qr ? `Resposta rápida: ${qr.title}` : "Nenhuma resposta escolhida" };
    }
    if (step.source === "campaign") {
      const c = savedCampaigns.find((c) => c.id === step.selectedCampaignId);
      return { time, content: c ? `Campanha: ${c.title}` : "Nenhuma campanha escolhida" };
    }
    const text = step.writeActions.find((a) => a.type === "text")?.text?.trim();
    const media = step.writeActions.find((a) => a.type !== "text");
    return {
      time,
      content: text || (media ? "Mídia sem legenda" : "Mensagem em branco"),
    };
  }

  const postSaleSummary = summarizeStep(postSaleStep);
  const returnSummary = summarizeStep(returnStep);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Pós-venda / Retorno</h3>
          <p className="text-xs text-neutral-500">
            {active ? "Ativo" : "Pausado"} · dispara pra quem for marcado com atendimento
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowReport(true)}>
            Relatório
          </Button>
          <span className="text-xs text-neutral-500">{active ? "Ativo" : "Pausado"}</span>
          <Switch checked={active} onCheckedChange={(v) => void saveActiveToggle(v)} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => setEditingStep("postsale")}
          className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-brand/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Pós-venda
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
              {postSaleSummary.time}
            </span>
          </div>
          <p className="truncate text-sm text-neutral-800">{postSaleSummary.content}</p>
          <span className="mt-1 text-xs font-medium text-brand">Editar</span>
        </button>

        <button
          onClick={() => setEditingStep("return")}
          className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:border-brand/40"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Retorno
            </span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
              {returnSummary.time}
            </span>
          </div>
          <p className="truncate text-sm text-neutral-800">{returnSummary.content}</p>
          <span className="mt-1 text-xs font-medium text-brand">Editar</span>
        </button>
      </div>

      {editingStep && (
        <StepEditModal
          title={editingStep === "postsale" ? "Mensagem de pós-venda" : "Mensagem de retorno"}
          hint={
            editingStep === "postsale"
              ? "Enviada depois do tempo abaixo, contado a partir do momento em que o atendimento foi marcado."
              : "Enviada depois do tempo abaixo, contado a partir do MESMO atendimento (sempre o mais recente). Se o cliente voltar antes desse prazo, a contagem recomeça do zero."
          }
          step={editingStep === "postsale" ? postSaleStep : returnStep}
          setStep={editingStep === "postsale" ? setPostSaleStep : setReturnStep}
          stepIndex={editingStep === "postsale" ? 0 : 1}
          isMetaProvider={isMetaProvider}
          templateOptions={templateOptions}
          templates={templates}
          quickReplies={quickReplies}
          savedCampaigns={savedCampaigns}
          funnel={funnel}
          preparing={preparingIndex === (editingStep === "postsale" ? 0 : 1)}
          api={api}
          saving={saving}
          onPickQuickReply={pickQuickReplyFor}
          onPickCampaign={pickCampaignFor}
          onSave={() => void submit({ onSuccess: () => setEditingStep(null) })}
          onClose={() => setEditingStep(null)}
        />
      )}

      {showReport && (
        <Dialog open onOpenChange={(v) => !v && setShowReport(false)}>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Relatório de atendimentos</DialogTitle>
            </DialogHeader>
            <AttendanceSection api={api} funnelId={funnel.id} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Modal de edição de UM passo (Pós-venda ou Retorno) — abre a partir
 * do card resumido, reaproveita o mesmo StepEditor do Follow-up. Salvar
 * aqui manda os DOIS passos juntos (a regra inteira), já que os dois
 * estados já ficam na memória o tempo todo — só o passo que o usuário
 * está olhando muda visualmente. */
function StepEditModal({
  title,
  hint,
  step,
  setStep,
  stepIndex,
  isMetaProvider,
  templateOptions,
  templates,
  quickReplies,
  savedCampaigns,
  funnel,
  preparing,
  api,
  saving,
  onPickQuickReply,
  onPickCampaign,
  onSave,
  onClose,
}: {
  title: string;
  hint: string;
  step: StepUI;
  setStep: React.Dispatch<React.SetStateAction<StepUI>>;
  stepIndex: number;
  isMetaProvider: boolean;
  templateOptions: TemplateOption[];
  templates: TemplateOption[];
  quickReplies: QuickReply[];
  savedCampaigns: SavedCampaign[];
  funnel: Funnel;
  preparing: boolean;
  api: Api;
  saving: boolean;
  onPickQuickReply: (setStep: React.Dispatch<React.SetStateAction<StepUI>>, qr: QuickReply) => void;
  onPickCampaign: (
    setStep: React.Dispatch<React.SetStateAction<StepUI>>,
    stepIndex: number,
    c: SavedCampaign,
  ) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-base font-semibold text-neutral-900">{title}</h3>
        <p className="mb-3 text-xs text-neutral-500">{hint}</p>
        <StepEditor
          index={stepIndex}
          step={step}
          showTime
          showRemove={false}
          isMetaProvider={isMetaProvider}
          approvedTemplates={templateOptions}
          templates={templates}
          quickReplies={quickReplies}
          savedCampaigns={savedCampaigns}
          funnels={[funnel]}
          preparing={preparing}
          api={api}
          onSetSource={(source) => setStep((prev) => ({ ...prev, source }))}
          onDelayChange={(delay_minutes) => setStep((prev) => ({ ...prev, delay_minutes }))}
          onWriteActionsChange={(writeActions) => setStep((prev) => ({ ...prev, writeActions }))}
          onTemplateChange={(patch) => setStep((prev) => ({ ...prev, ...patch }))}
          onPickQuickReply={(qr) => onPickQuickReply(setStep, qr)}
          onPickCampaign={(c) => void onPickCampaign(setStep, stepIndex, c)}
          onRemove={() => {}}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Lista de atendimentos embutida direto na página (não mais modal),
 * agrupada por dia (cada dia expande/retrai com um clique), com filtro
 * por período: Mês (padrão), Semana, Dia, ou Personalizado (escolhe as
 * datas). Pedido do usuário: filtro por preset em vez de sempre pedir
 * pra escolher data de/até na mão, e lista mais compacta (só o dia
 * aparece de cara, os atendimentos daquele dia só na hora de expandir). */
type AttendancePeriod = "month" | "week" | "day" | "custom";

function periodToRange(period: AttendancePeriod, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  if (period === "day") return { from: toIso(today), to: toIso(today) };
  if (period === "week") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: toIso(from), to: toIso(today) };
  }
  if (period === "custom") return { from: customFrom, to: customTo };
  // "month" (padrão): últimos 30 dias corridos, não o mês-calendário.
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { from: toIso(from), to: toIso(today) };
}

function AttendanceSection({ api, funnelId }: { api: Api; funnelId: string }) {
  const [period, setPeriod] = useState<AttendancePeriod>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [attendances, setAttendances] = useState<Array<{
    id: string;
    entered_at: string;
    name: string;
    phone: string | null;
  }> | null>(null);

  async function load(p: AttendancePeriod, from: string, to: string) {
    setAttendances(null);
    const params = new URLSearchParams({ funnel_id: funnelId });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const r = await api(`/api/public/extension/postsale-attendances?${params.toString()}`);
    setAttendances(
      r?.ok
        ? (r.attendances as Array<{
            id: string;
            entered_at: string;
            name: string;
            phone: string | null;
          }>)
        : [],
    );
  }

  useEffect(() => {
    const { from, to } = periodToRange(period, customFrom, customTo);
    // Personalizado só busca quando as duas datas já foram escolhidas -
    // busca com uma só (ou nenhuma) não faz sentido e pode trazer tudo.
    if (period === "custom" && (!from || !to)) return;
    void load(period, from, to);
    setExpandedDays(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  function toggleDay(day: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  const groups = new Map<string, typeof attendances>();
  for (const a of attendances ?? []) {
    const day = new Date(a.entered_at).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      weekday: "long",
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(a);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Atendimentos
        </h4>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex overflow-hidden rounded-lg border border-neutral-300">
            {(
              [
                { key: "month", label: "Mês" },
                { key: "week", label: "Semana" },
                { key: "day", label: "Dia" },
                { key: "custom", label: "Personalizado" },
              ] as { key: AttendancePeriod; label: string }[]
            ).map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriod(opt.key)}
                className={`px-3 py-1 text-xs font-medium transition ${
                  period === opt.key
                    ? "bg-brand text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {period === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
              />
              <span className="text-xs text-neutral-400">até</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-1 text-xs"
              />
            </>
          )}
        </div>
      </div>

      {attendances === null ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : attendances.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-6 text-center">
          <p className="text-sm text-neutral-500">Nenhum atendimento nesse período.</p>
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {[...groups.entries()].map(([day, items]) => {
            const isOpen = expandedDays.has(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`rounded-xl border p-3 text-left transition ${
                  isOpen
                    ? "border-brand bg-brand/5"
                    : "border-neutral-200 bg-white hover:bg-neutral-50"
                }`}
              >
                <p className="text-xs font-semibold capitalize text-neutral-700">{day}</p>
                <p className="mt-1 text-[11px] text-neutral-400">
                  {items!.length} {items!.length === 1 ? "atendimento" : "atendimentos"}
                </p>
              </button>
            );
          })}
        </div>
        {[...groups.entries()]
          .filter(([day]) => expandedDays.has(day))
          .map(([day, items]) => (
            <div key={day} className="mt-2 rounded-xl border border-neutral-200 bg-white">
              <div className="rounded-t-xl border-b border-neutral-100 bg-neutral-50 px-4 py-2">
                <span className="text-xs font-semibold capitalize text-neutral-600">{day}</span>
              </div>
              <div className="divide-y divide-neutral-100">
                {items!.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-medium text-neutral-900">{a.name}</span>
                    <span className="text-xs text-neutral-500">
                      {new Date(a.entered_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
