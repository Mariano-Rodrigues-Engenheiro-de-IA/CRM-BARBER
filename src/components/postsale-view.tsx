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
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import type { Funnel } from "@/lib/funnels";
import type { QuickReply } from "@/lib/quick-replies";
import type { SavedCampaign } from "@/components/campaigns-marketplace-view";
import {
  StepEditor,
  stepUIFromContent,
  resolveStepActions,
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

export function PostsaleView({ api }: { api: Api }) {
  const [funnel, setFunnel] = useState<Funnel | null | undefined>(undefined); // undefined = carregando
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [savedCampaigns, setSavedCampaigns] = useState<SavedCampaign[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [active, setActive] = useState(true);
  const [badgePeriodDays, setBadgePeriodDays] = useState(30);
  const [postSaleStep, setPostSaleStep] = useState<StepUI>(stepUIFromContent());
  const [returnStep, setReturnStep] = useState<StepUI>(stepUIFromContent());
  const [saving, setSaving] = useState(false);
  const [preparingIndex, setPreparingIndex] = useState<number | null>(null);
  const [showReport, setShowReport] = useState(false);

  async function reloadAll() {
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
      setBadgePeriodDays(found?.badge_period_days ?? 30);
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

  async function submit() {
    if (!funnel) {
      toast.error(
        "Ainda não teve nenhum atendimento marcado. Essa aba fica pronta no primeiro clique na tesoura, numa conversa.",
      );
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
        active,
        moment: "time_in_stage",
        skip_if_replied: false,
        badge_period_days: badgePeriodDays,
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
    } else {
      toast.error((r?.error as string) || "Não consegui salvar.");
    }
  }

  if (funnel === undefined) {
    return <p className="text-sm text-neutral-500">Carregando…</p>;
  }

  if (!funnel) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
        <p className="text-sm text-neutral-500">
          Ainda não teve nenhum atendimento marcado. Assim que você clicar no ícone de tesoura numa
          conversa pela primeira vez, essa aba fica pronta pra configurar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Pós-venda / Retorno</h3>
          <p className="text-xs text-neutral-500">
            {active ? "Ativo" : "Pausado"} · dispara pra quem for marcado com atendimento
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowReport(true)} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" /> Relatório
        </Button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300"
        />
        <Label className="text-sm text-neutral-700">Pós-venda ativo</Label>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
        <Label className="mb-2 block text-sm text-neutral-700">
          Contador na tesourinha (WhatsApp e CRM)
        </Label>
        <p className="mb-2 text-xs text-neutral-500">
          Quantos atendimentos aparecem no selinho, olhando pra trás:
        </p>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setBadgePeriodDays(7)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${badgePeriodDays === 7 ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Última semana
          </button>
          <button
            type="button"
            onClick={() => setBadgePeriodDays(30)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${badgePeriodDays === 30 ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Último mês
          </button>
          <button
            type="button"
            onClick={() => setBadgePeriodDays(60)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${badgePeriodDays === 60 ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Últimos 2 meses
          </button>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Mensagem de pós-venda
        </h4>
        <p className="mb-2 text-xs text-neutral-500">
          Enviada depois do tempo abaixo, contado a partir do momento em que o atendimento foi
          marcado.
        </p>
        <StepEditor
          index={0}
          step={postSaleStep}
          showTime
          showRemove={false}
          isMetaProvider={isMetaProvider}
          approvedTemplates={templateOptions}
          templates={templates}
          quickReplies={quickReplies}
          savedCampaigns={savedCampaigns}
          funnels={[funnel]}
          preparing={preparingIndex === 0}
          api={api}
          onSetSource={(source) => setPostSaleStep((prev) => ({ ...prev, source }))}
          onDelayChange={(delay_minutes) => setPostSaleStep((prev) => ({ ...prev, delay_minutes }))}
          onWriteActionsChange={(writeActions) =>
            setPostSaleStep((prev) => ({ ...prev, writeActions }))
          }
          onTemplateChange={(patch) => setPostSaleStep((prev) => ({ ...prev, ...patch }))}
          onPickQuickReply={(qr) => pickQuickReplyFor(setPostSaleStep, qr)}
          onPickCampaign={(c) => void pickCampaignFor(setPostSaleStep, 0, c)}
          onRemove={() => {}}
        />
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Mensagem de retorno
        </h4>
        <p className="mb-2 text-xs text-neutral-500">
          Enviada depois do tempo abaixo, contado a partir do MESMO atendimento (sempre o mais
          recente. Se o cliente voltar antes desse prazo, a contagem recomeça do zero).
        </p>
        <StepEditor
          index={1}
          step={returnStep}
          showTime
          showRemove={false}
          isMetaProvider={isMetaProvider}
          approvedTemplates={templateOptions}
          templates={templates}
          quickReplies={quickReplies}
          savedCampaigns={savedCampaigns}
          funnels={[funnel]}
          preparing={preparingIndex === 1}
          api={api}
          onSetSource={(source) => setReturnStep((prev) => ({ ...prev, source }))}
          onDelayChange={(delay_minutes) => setReturnStep((prev) => ({ ...prev, delay_minutes }))}
          onWriteActionsChange={(writeActions) =>
            setReturnStep((prev) => ({ ...prev, writeActions }))
          }
          onTemplateChange={(patch) => setReturnStep((prev) => ({ ...prev, ...patch }))}
          onPickQuickReply={(qr) => pickQuickReplyFor(setReturnStep, qr)}
          onPickCampaign={(c) => void pickCampaignFor(setReturnStep, 1, c)}
          onRemove={() => {}}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void submit()} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {showReport && (
        <PostsaleReportModal api={api} funnelId={funnel.id} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

function PostsaleReportModal({
  api,
  funnelId,
  onClose,
}: {
  api: Api;
  funnelId: string;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<"day" | "week" | "month">("week");
  const [report, setReport] = useState<{
    attendances: number;
    postsale_sent: number;
    return_sent: number;
  } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [attendances, setAttendances] = useState<Array<{
    id: string;
    entered_at: string;
    name: string;
    phone: string | null;
  }> | null>(null);

  useEffect(() => {
    api(`/api/public/extension/postsale-report?funnel_id=${funnelId}&period=${period}`).then(
      (r) => {
        if (r?.ok) setReport(r.report as typeof report);
        else setReport({ attendances: 0, postsale_sent: 0, return_sent: 0 });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  async function loadAttendances() {
    setAttendances(null);
    const params = new URLSearchParams({ funnel_id: funnelId });
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
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
    void loadAttendances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-base font-semibold text-neutral-900">Relatório de pós-venda</h3>
        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => setPeriod("day")}
            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${period === "day" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Hoje
          </button>
          <button
            onClick={() => setPeriod("week")}
            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${period === "week" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Semana
          </button>
          <button
            onClick={() => setPeriod("month")}
            className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${period === "month" ? "border-brand bg-brand text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            Mês
          </button>
        </div>
        {!report ? (
          <p className="text-sm text-neutral-500">Carregando…</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <span className="text-neutral-600">Atendimentos marcados</span>
              <span className="font-semibold text-neutral-900">{report.attendances}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <span className="text-neutral-600">Pós-vendas enviados</span>
              <span className="font-semibold text-neutral-900">{report.postsale_sent}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 text-sm">
              <span className="text-neutral-600">Retornos enviados</span>
              <span className="font-semibold text-neutral-900">{report.return_sent}</span>
            </div>
          </div>
        )}

        <div className="mt-5 border-t border-neutral-100 pt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Quem foi atendido
          </h4>
          <div className="mb-3 flex items-end gap-2">
            <div>
              <Label className="mb-1 block text-xs">De</Label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Até</Label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadAttendances()}>
              Filtrar
            </Button>
          </div>
          {attendances === null ? (
            <p className="text-sm text-neutral-500">Carregando…</p>
          ) : attendances.length === 0 ? (
            <p className="text-sm text-neutral-500">Nenhum atendimento nesse período.</p>
          ) : (
            <div className="max-h-64 space-y-1.5 overflow-y-auto">
              {attendances.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-neutral-900">{a.name}</p>
                    {a.phone && <p className="text-xs text-neutral-500">{a.phone}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {new Date(a.entered_at).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
