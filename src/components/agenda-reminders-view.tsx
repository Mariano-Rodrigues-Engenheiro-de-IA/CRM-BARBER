// Sub-aba da Agenda: Lembretes / Confirmações.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Bell, MessageSquareCheck, Plus, Trash2, Pencil, X } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type ReminderRule = {
  id: string;
  name: string;
  kind: "reminder" | "confirmation";
  offset_minutes: number;
  applies_to_statuses: string[];
  message_text: string | null;
  template_name: string | null;
  template_language: string | null;
  confirm_button_text: string | null;
  active: boolean;
};

type TemplateOption = { name: string; language: string; status: string; hasQuickReplyButtons: boolean; buttonTexts: string[] };

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Aguardando confirmação",
  confirmed: "Confirmado",
  done: "Finalizado",
  canceled: "Cancelado",
};

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

export function AgendaRemindersView({ api }: { api: Api }) {
  const [rules, setRules] = useState<ReminderRule[] | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [isMetaProvider, setIsMetaProvider] = useState(false);
  const [editing, setEditing] = useState<ReminderRule | null | "new">(null);
  const { confirm, dialog } = useConfirm();

  async function reload() {
    const r = await api("/api/public/extension/agenda-reminder-rules");
    if (r?.ok) setRules((r.rules as ReminderRule[]) || []);
  }

  useEffect(() => {
    void reload();
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
              components?: Array<{ type?: string; buttons?: Array<{ type?: string; text?: string }> }>;
            }>) || []
          ).map((tpl) => {
            const buttonsComp = (tpl.components || []).find((c) => String(c.type).toUpperCase() === "BUTTONS");
            const quickReplies = (buttonsComp?.buttons || []).filter((b) => String(b.type).toUpperCase() === "QUICK_REPLY");
            return {
              name: tpl.name,
              language: tpl.language,
              status: tpl.status,
              hasQuickReplyButtons: quickReplies.length > 0,
              buttonTexts: quickReplies.map((b) => b.text || "").filter(Boolean),
            };
          }),
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(rule: ReminderRule) {
    const r = await api(`/api/public/extension/agenda-reminder-rules/${rule.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !rule.active }),
    });
    if (r?.ok) {
      setRules((list) => (list ?? []).map((x) => (x.id === rule.id ? { ...x, active: !rule.active } : x)));
    } else {
      toast.error((r?.error as string) || "Não consegui atualizar.");
    }
  }

  async function removeRule(rule: ReminderRule) {
    const ok = await confirm({
      title: `Excluir "${rule.name}"?`,
      description: "Essa regra vai parar de disparar. Agendamentos já processados não são afetados.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    const r = await api(`/api/public/extension/agenda-reminder-rules/${rule.id}`, { method: "DELETE" });
    if (r?.ok) {
      setRules((list) => (list ?? []).filter((x) => x.id !== rule.id));
      toast.success("Regra excluída.");
    } else {
      toast.error((r?.error as string) || "Não consegui excluir.");
    }
  }

  return (
    <div className="space-y-4">
      {dialog}
      <div className="flex items-center justify-end">
        <Button onClick={() => setEditing("new")} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nova regra
        </Button>
      </div>

      {rules === null ? (
        <p className="text-sm text-neutral-500">Carregando…</p>
      ) : rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center">
          <p className="text-sm text-neutral-500">Nenhuma regra ainda. Cria a primeira pra começar a automatizar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const { value, unit } = minutesToValueUnit(rule.offset_minutes);
            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${rule.kind === "confirmation" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>
                  {rule.kind === "confirmation" ? <MessageSquareCheck className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{rule.name}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {rule.kind === "confirmation" ? "Confirmação" : "Lembrete"}, {value} {unit} antes,{" "}
                    {rule.applies_to_statuses.map((s) => STATUS_LABELS[s] || s).join(", ")}
                  </p>
                </div>
                <Switch checked={rule.active} onCheckedChange={() => void toggleActive(rule)} />
                <Button variant="ghost" size="icon" onClick={() => setEditing(rule)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void removeRule(rule)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ReminderRuleForm
          api={api}
          rule={editing === "new" ? null : editing}
          templates={templates}
          isMetaProvider={isMetaProvider}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ReminderRuleForm({
  api,
  rule,
  templates,
  isMetaProvider,
  onClose,
  onSaved,
}: {
  api: Api;
  rule: ReminderRule | null;
  templates: TemplateOption[];
  isMetaProvider: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rule?.name || "");
  const [kind, setKind] = useState<"reminder" | "confirmation">(rule?.kind || "reminder");
  const initial = minutesToValueUnit(rule?.offset_minutes ?? 24 * 60);
  const [offsetValue, setOffsetValue] = useState(initial.value);
  const [offsetUnit, setOffsetUnit] = useState<"minutos" | "horas" | "dias">(initial.unit);
  const [statuses, setStatuses] = useState<string[]>(rule?.applies_to_statuses || ["scheduled", "confirmed"]);
  const [messageText, setMessageText] = useState(rule?.message_text || "");
  const [templateName, setTemplateName] = useState(rule?.template_name || "");
  const [confirmButtonText, setConfirmButtonText] = useState(rule?.confirm_button_text || "");
  const [saving, setSaving] = useState(false);

  const reminderNeedsTemplate = kind === "reminder" && isMetaProvider;
  const allTemplates = templates.filter((t) => t.status === "APPROVED");
  const confirmTemplates = allTemplates.filter((t) => t.hasQuickReplyButtons);
  const templateOptions = kind === "confirmation" ? confirmTemplates : allTemplates;
  const selectedTemplate = templates.find((t) => t.name === templateName);
  const usesTemplate = kind === "confirmation" || reminderNeedsTemplate;

  async function submit() {
    if (!name.trim()) return toast.error("Dá um nome pra regra.");
    if (usesTemplate && !templateName) return toast.error("Escolhe um modelo aprovado.");
    if (!usesTemplate && !messageText.trim()) return toast.error("Escreve a mensagem do lembrete.");
    if (kind === "confirmation" && !confirmButtonText) return toast.error("Escolhe qual botão conta como confirmação.");
    if (!statuses.length) return toast.error("Escolhe pelo menos um status de agendamento.");

    setSaving(true);
    const body = {
      name: name.trim(),
      kind,
      offset_minutes: valueUnitToMinutes(offsetValue, offsetUnit),
      applies_to_statuses: statuses,
      message_text: usesTemplate ? null : messageText.trim(),
      template_name: usesTemplate ? templateName : null,
      template_language: usesTemplate ? selectedTemplate?.language || "pt_BR" : null,
      confirm_button_text: kind === "confirmation" ? confirmButtonText : null,
    };
    const r = rule
      ? await api(`/api/public/extension/agenda-reminder-rules/${rule.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await api("/api/public/extension/agenda-reminder-rules", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (r?.ok) {
      toast.success(rule ? "Regra atualizada." : "Regra criada.");
      onSaved();
    } else {
      toast.error((r?.error as string) || "Não consegui salvar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">{rule ? "Editar regra" : "Nova regra"}</h3>
          <button onClick={onClose} className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Nome da regra</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Lembrete 1 dia antes" />
          </div>

          <div>
            <Label>Tipo</Label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("reminder")}
                className={`rounded-lg border p-3 text-left text-sm transition ${kind === "reminder" ? "border-brand bg-brand/5 font-medium" : "border-neutral-200 hover:bg-neutral-50"}`}
              >
                <Bell className="mb-1 h-4 w-4 text-amber-600" />
                <p className="font-medium text-neutral-900">Lembrete</p>
                <p className="text-xs text-neutral-500">Aviso informativo</p>
              </button>
              <button
                type="button"
                onClick={() => setKind("confirmation")}
                className={`rounded-lg border p-3 text-left text-sm transition ${kind === "confirmation" ? "border-brand bg-brand/5 font-medium" : "border-neutral-200 hover:bg-neutral-50"}`}
              >
                <MessageSquareCheck className="mb-1 h-4 w-4 text-sky-600" />
                <p className="font-medium text-neutral-900">Confirmação</p>
                <p className="text-xs text-neutral-500">Modelo com botão, confirma sozinho</p>
              </button>
            </div>
          </div>

          <div>
            <Label>Quando disparar</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                min={0}
                value={offsetValue}
                onChange={(e) => setOffsetValue(Math.max(0, Number(e.target.value) || 0))}
                className="w-24"
              />
              <Select value={offsetUnit} onValueChange={(v) => setOffsetUnit(v as any)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutos">minutos</SelectItem>
                  <SelectItem value="horas">horas</SelectItem>
                  <SelectItem value="dias">dias</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-neutral-500">antes do agendamento</span>
            </div>
          </div>

          <div>
            <Label>Agendamentos com status</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([value, label]) => {
                const checked = statuses.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setStatuses((prev) => (checked ? prev.filter((s) => s !== value) : [...prev, value]))
                    }
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${checked ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {!usesTemplate ? (
            <div>
              <Label>Mensagem</Label>
              <Textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={4}
                placeholder={"Oi {nome}! Passando pra lembrar do seu horário dia {data} às {hora}."}
              />
              <p className="mt-1 text-xs text-neutral-500">
                Variáveis: <code className="rounded bg-neutral-100 px-1">{"{nome}"}</code>{" "}
                <code className="rounded bg-neutral-100 px-1">{"{data}"}</code>{" "}
                <code className="rounded bg-neutral-100 px-1">{"{hora}"}</code>{" "}
                <code className="rounded bg-neutral-100 px-1">{"{servico}"}</code>{" "}
                <code className="rounded bg-neutral-100 px-1">{"{profissional}"}</code>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reminderNeedsTemplate && (
                <p className="text-xs text-neutral-500">
                  Seu número está conectado via Meta, então o lembrete precisa de um modelo aprovado.
                </p>
              )}
              <div>
                <Label>Modelo aprovado{kind === "confirmation" ? " com botões" : ""}</Label>
                {templateOptions.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-600">
                    Nenhum modelo aprovado{kind === "confirmation" ? " com botões de resposta rápida" : ""} encontrado.
                    Cria um na aba Modelos{kind === "confirmation" ? ' com botões tipo "Confirmar" e "Cancelar"' : ""}.
                  </p>
                ) : (
                  <Select value={templateName} onValueChange={(v) => { setTemplateName(v); setConfirmButtonText(""); }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um modelo…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templateOptions.map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {kind === "confirmation" && selectedTemplate && selectedTemplate.buttonTexts.length > 0 && (
                <div>
                  <Label>Qual botão conta como confirmação</Label>
                  <Select value={confirmButtonText} onValueChange={setConfirmButtonText}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha o botão…" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedTemplate.buttonTexts.map((bt) => (
                        <SelectItem key={bt} value={bt}>
                          {bt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-neutral-500">
                    Quando o cliente tocar nesse botão, o agendamento muda pra "Confirmado" sozinho.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
