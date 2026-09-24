// Gaveta de detalhe do card do funil (CardDrawer) - anotações, mensagens
// agendadas e perfil/negócio do lead, com as três sub-abas. Extraído de
// funnels-view.tsx pra reduzir o tamanho desse arquivo (era um dos 3
// arquivos gigantes apontados na varredura de código morto/arquitetura).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { type FunnelCard } from "@/lib/funnels";
import { canOpenWhatsapp, openWhatsappChat } from "@/lib/wa-actions";
import { IconDeal, IconPencilMini, IconTrashMini, IconWhatsapp } from "@/components/painel-icons";
import { type ApiFn, Overlay, inputCls } from "@/components/funnels-view";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

/** Pipeline do lead do funil: anotações + mensagem agendada/disparo. */
export function CardDrawer({
  api,
  card,
  initialTab,
  onClose,
  onDealSaved,
}: {
  api: ApiFn;
  card: FunnelCard;
  initialTab: "notes" | "schedule" | "profile";
  onClose: () => void;
  onDealSaved?: () => void;
}) {
  // Cada ícone do card abre um painel dedicado, sem sub-abas pra trocar —
  // por isso não precisa de estado próprio, só usa o que veio de fora.
  const tab = initialTab;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Resumo gerado pela IA (projeto IA-BARBER-AGENDA) — busca separada,
  // pra não pesar a lista geral de clientes com esse campo toda vez.
  const [aiSummary, setAiSummary] = useState<{ text: string; updatedAt: string | null } | null>(
    null,
  );
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);

  // Perfil do cliente / Valor do cliente / Resumo da IA / Anotações /
  // Mensagens agendadas — mesma identidade de contato acessível pela
  // extensão do WhatsApp (ícones na conversa). Manda os dois campos
  // quando disponíveis (não só um): um registro pode ter sido salvo com
  // qualquer um dos dois — sem os dois na busca, não acha um pelo outro.
  const contactQuery = (() => {
    const parts: string[] = [];
    if (card.wa_contact_id) parts.push(`wa_contact_id=${encodeURIComponent(card.wa_contact_id)}`);
    if (card.phone) parts.push(`phone=${encodeURIComponent(card.phone)}`);
    return parts.length ? parts.join("&") : null;
  })();

  useEffect(() => {
    // O resumo da IA vive em customer_profiles agora (casa com QUALQUER
    // lead por wa_contact_id/telefone) — antes vivia na tabela de
    // assinantes, e por isso quase nunca era encontrado: a IA mandava
    // certinho, mas o CRM descartava em silêncio por "cliente não
    // encontrado", dando a impressão de bug de tela ("carrega e some").
    if (!contactQuery) return;
    setAiSummaryLoading(true);
    api(`/api/public/extension/customer-profile?${contactQuery}`)
      .then((r) => {
        const profile = (r as { ok?: boolean; profile?: Record<string, unknown> | null })?.profile;
        if (profile?.ai_summary) {
          setAiSummary({
            text: profile.ai_summary as string,
            updatedAt: (profile.ai_summary_updated_at ?? null) as string | null,
          });
        }
      })
      .finally(() => setAiSummaryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactQuery]);

  // Anotações — MESMA lead_notes usada no ícone de Anotações do WhatsApp
  // (várias notas, texto e/ou mídia), não mais um campo único.
  type LeadNote = {
    id: string;
    body: string | null;
    media_url: string | null;
    media_mime: string | null;
    media_path?: string | null;
    media_filename?: string | null;
    created_at: string;
  };
  const [notesList, setNotesList] = useState<LeadNote[] | null>(null);
  const [newNoteBody, setNewNoteBody] = useState("");
  const noteFileRef = useRef<HTMLInputElement | null>(null);
  const [noteUploaded, setNoteUploaded] = useState<{
    path: string;
    mime: string;
    filename: string;
  } | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteStage, setNoteStage] = useState<"list" | "form">("list");

  async function loadNotes() {
    if (!contactQuery) return;
    const r = await api(`/api/public/extension/lead-notes?${contactQuery}`);
    setNotesList((r?.ok ? (r.notes as LeadNote[]) : []) || []);
  }
  useEffect(() => {
    if (tab === "notes") {
      setNoteStage("list");
      void loadNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function startEditNote(n: LeadNote) {
    setEditingNoteId(n.id);
    setNewNoteBody(n.body || "");
    setNoteUploaded(
      n.media_path
        ? { path: n.media_path, mime: n.media_mime || "", filename: n.media_filename || "" }
        : null,
    );
  }
  function cancelEditNote() {
    setEditingNoteId(null);
    setNewNoteBody("");
    setNoteUploaded(null);
  }

  async function addNote() {
    if (!newNoteBody.trim() && !noteUploaded) return false;
    setBusy(true);
    const r = editingNoteId
      ? await api(`/api/public/extension/lead-notes/${editingNoteId}`, {
          method: "PATCH",
          body: JSON.stringify({
            body: newNoteBody.trim() || null,
            media_path: noteUploaded?.path || null,
            media_mime: noteUploaded?.mime || null,
            media_filename: noteUploaded?.filename || null,
          }),
        })
      : await api("/api/public/extension/lead-notes", {
          method: "POST",
          body: JSON.stringify({
            wa_contact_id: card.wa_contact_id || null,
            phone: card.phone || null,
            body: newNoteBody.trim() || null,
            media_path: noteUploaded?.path || null,
            media_mime: noteUploaded?.mime || null,
            media_filename: noteUploaded?.filename || null,
          }),
        });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao salvar anotação");
      return false;
    }
    setErr(null);
    setNewNoteBody("");
    setNoteUploaded(null);
    setEditingNoteId(null);
    void loadNotes();
    return true;
  }

  async function removeNote(id: string) {
    await api(`/api/public/extension/lead-notes/${id}`, { method: "DELETE" });
    void loadNotes();
  }

  async function onPickNoteFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
        reader.readAsDataURL(file);
      });
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }),
      });
      if (r?.ok)
        setNoteUploaded({
          path: r.path as string,
          mime: r.mime as string,
          filename: r.filename as string,
        });
      else setErr((r?.error as string) || "Não consegui enviar o arquivo.");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // Mensagens agendadas — MESMA fila usada no ícone de Mensagens Agendadas
  // do WhatsApp (lead-schedule), pra ficar sincronizado nos dois lugares.
  type QuickReplyAction = {
    type: string;
    text?: string | null;
    path?: string | null;
    url?: string | null;
    mime?: string | null;
    filename?: string | null;
    caption?: string | null;
  };
  type ScheduledJob = {
    id: string;
    rendered_body: string;
    message_actions?: QuickReplyAction[] | null;
    scheduled_for: string;
    status: string;
    last_error: string | null;
  };
  const [jobsList, setJobsList] = useState<ScheduledJob[] | null>(null);
  const [scheduleStage, setScheduleStage] = useState<"list" | "form">("list");
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [scheduleType, setScheduleType] = useState<"text" | "image" | "audio" | "qr">("text");
  const [scheduleUploaded, setScheduleUploaded] = useState<{
    path: string;
    mime: string;
    filename: string;
  } | null>(null);
  const [scheduleCaption, setScheduleCaption] = useState("");
  const [scheduleQrId, setScheduleQrId] = useState("");
  const [availableQuickReplies, setAvailableQuickReplies] = useState<
    { id: string; title: string; actions: QuickReplyAction[] }[] | null
  >(null);
  const scheduleFileRef = useRef<HTMLInputElement | null>(null);

  async function loadJobs() {
    if (!card.phone) return;
    const r = await api(
      `/api/public/extension/lead-schedule?phone=${encodeURIComponent(card.phone)}`,
    );
    setJobsList((r?.ok ? (r.jobs as ScheduledJob[]) : []) || []);
  }
  useEffect(() => {
    if (tab === "schedule") {
      setScheduleStage("list");
      void loadJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function resetScheduleForm() {
    setEditingJobId(null);
    setMsg("");
    setWhen("");
    setScheduleType("text");
    setScheduleUploaded(null);
    setScheduleCaption("");
    setScheduleQrId("");
  }
  function startEditJob(j: ScheduledJob) {
    setEditingJobId(j.id);
    setMsg(j.rendered_body);
    const d = new Date(j.scheduled_for);
    setWhen(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    );
    setScheduleType("text");
    setScheduleUploaded(null);
    setScheduleCaption("");
    setScheduleQrId("");
  }

  async function ensureQuickReplies() {
    if (availableQuickReplies !== null) return;
    const r = await api("/api/public/extension/quick-replies");
    setAvailableQuickReplies(
      (r?.ok ? (r.quick_replies as typeof availableQuickReplies) : []) || [],
    );
  }

  async function onPickScheduleFile(file: File) {
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
        reader.readAsDataURL(file);
      });
      const r = await api("/api/public/extension/quick-replies/upload", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, data_base64: dataUrl }),
      });
      if (r?.ok)
        setScheduleUploaded({
          path: r.path as string,
          mime: r.mime as string,
          filename: r.filename as string,
        });
      else setErr((r?.error as string) || "Não consegui enviar o arquivo.");
    } catch (e) {
      setErr(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function schedule() {
    if (!card.phone) return false;
    let body: Record<string, unknown>;
    if (scheduleType === "text") {
      if (!msg.trim()) {
        setErr("Escreva a mensagem.");
        return false;
      }
      body = { message: msg.trim() };
    } else if (scheduleType === "image" || scheduleType === "audio") {
      if (!scheduleUploaded) {
        setErr("Escolha um arquivo.");
        return false;
      }
      body = {
        actions: [
          {
            type: scheduleType,
            path: scheduleUploaded.path,
            mime: scheduleUploaded.mime,
            filename: scheduleUploaded.filename,
            caption: scheduleCaption.trim() || undefined,
          },
        ],
      };
    } else {
      const qr = availableQuickReplies?.find((q) => q.id === scheduleQrId);
      if (!qr) {
        setErr("Escolha uma resposta rápida.");
        return false;
      }
      body = {
        actions: qr.actions.filter((a) => ["text", "image", "audio", "video"].includes(a.type)),
      };
    }
    setBusy(true);
    setErr(null);
    const r = editingJobId
      ? await api(`/api/public/extension/lead-schedule/${editingJobId}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...body,
            scheduled_for: when ? new Date(when).toISOString() : undefined,
          }),
        })
      : await api("/api/public/extension/lead-schedule", {
          method: "POST",
          body: JSON.stringify({
            wa_contact_id: card.wa_contact_id || null,
            phone: card.phone,
            name: card.title,
            scheduled_for: when ? new Date(when).toISOString() : undefined,
            ...body,
          }),
        });
    setBusy(false);
    if (!r?.ok) {
      setErr((r?.error as string) || "Erro ao agendar");
      return false;
    }
    resetScheduleForm();
    void loadJobs();
    return true;
  }

  async function cancelJob(id: string) {
    await api(`/api/public/extension/lead-schedule/${id}`, { method: "DELETE" });
    void loadJobs();
  }

  // Perfil e Valor do cliente são um formulário só (mesma unificação na
  // extensão do WhatsApp) — um só carregamento, um só salvamento.
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [deal, setDeal] = useState<Record<string, unknown> | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [dealValueText, setDealValueText] = useState("");
  const [cpBusy, setCpBusy] = useState(false);
  const [cpDirty, setCpDirty] = useState(false);

  useEffect(() => {
    if (tab === "profile" && !profileLoaded && contactQuery) {
      Promise.all([
        api(`/api/public/extension/customer-profile?${contactQuery}`),
        api(`/api/public/extension/customer-deal?${contactQuery}`),
      ]).then(([rp, rd]) => {
        const p = ((rp?.ok ? rp.profile : null) as Record<string, unknown> | null) || {};
        if (!p.name && card.title) p.name = card.title;
        const d = ((rd?.ok ? rd.deal : null) as Record<string, unknown> | null) || {};
        if (!d.notes && card.notes) d.notes = card.notes;
        setProfile(p);
        setDeal(d);
        setDealValueText(
          d.value_cents != null
            ? ((d.value_cents as number) / 100).toFixed(2).replace(".", ",")
            : "",
        );
        setProfileLoaded(true);
        setCpDirty(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function saveProfile() {
    if (!profile || !deal) return;
    setCpBusy(true);
    const num = parseFloat(dealValueText.replace(/\./g, "").replace(",", "."));
    const value_cents =
      dealValueText.trim() === "" ? null : Number.isFinite(num) ? Math.round(num * 100) : null;
    if (card.id && typeof deal.notes === "string" && deal.notes !== (card.notes ?? "")) {
      await api("/api/public/extension/funnel-cards", {
        method: "PATCH",
        body: JSON.stringify({ id: card.id, notes: deal.notes || null }),
      });
    }
    const [r1, r2] = await Promise.all([
      api("/api/public/extension/customer-profile", {
        method: "PATCH",
        body: JSON.stringify({
          wa_contact_id: card.wa_contact_id || null,
          phone: card.phone || null,
          ...profile,
        }),
      }),
      api("/api/public/extension/customer-deal", {
        method: "PATCH",
        body: JSON.stringify({
          wa_contact_id: card.wa_contact_id || null,
          phone: card.phone || null,
          ...deal,
          value_cents,
        }),
      }),
    ]);
    setDeal({ ...deal, value_cents });
    setCpBusy(false);
    if (r1?.ok && r2?.ok) {
      setCpDirty(false);
      onDealSaved?.();
    } else {
      setErr(
        (!r1?.ok && (r1?.error as string)) ||
          (!r2?.ok && (r2?.error as string)) ||
          "Erro ao salvar",
      );
    }
  }

  return (
    <Overlay title={tab === "profile" ? "Perfil do cliente" : card.title} onClose={onClose}>
      <div className="space-y-4">
        {tab !== "profile" && aiSummaryLoading && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs text-neutral-400">
            Carregando resumo da IA...
          </div>
        )}
        {tab !== "profile" && aiSummary && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
              <span>✨</span> Resumo da IA
            </div>
            <p className="whitespace-pre-wrap text-xs text-neutral-700">{aiSummary.text}</p>
            {aiSummary.updatedAt && (
              <p className="mt-1.5 text-[10px] text-neutral-400">
                Atualizado{" "}
                {new Date(aiSummary.updatedAt).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        )}

        {tab !== "profile" && (
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {tab === "notes" ? "Anotações" : "Mensagens agendadas"}
            </h4>
            {canOpenWhatsapp(card.phone, card.wa_id) && (
              <button
                onClick={() => void openWhatsappChat(card.phone || "", card.title, card.wa_id)}
                className="flex items-center gap-1.5 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-neutral-50"
              >
                <IconWhatsapp /> WhatsApp
              </button>
            )}
          </div>
        )}

        {tab === "notes" && noteStage === "list" && (
          <>
            {notesList === null && (
              <p className="py-6 text-center text-sm text-neutral-400">Carregando...</p>
            )}
            {notesList?.length === 0 && (
              <div className="flex flex-col items-center px-2 pb-2 pt-7 text-center">
                <div className="mb-3.5 text-neutral-300">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="5" y="4" width="14" height="17" rx="2" />
                    <path d="M9 4V3.3A1.3 1.3 0 0 1 10.3 2h3.4A1.3 1.3 0 0 1 15 3.3V4" />
                    <path d="m10 17 6.2-6.2a1.15 1.15 0 0 0-1.6-1.6L8.4 15.4l-.5 2.1z" />
                  </svg>
                </div>
                <p className="mb-2 text-base font-extrabold text-neutral-900">
                  Nenhuma nota encontrada
                </p>
                <p className="mb-5 max-w-xs text-[13px] leading-relaxed text-neutral-500">
                  Parece que você ainda não adicionou nenhuma nota. Clique no botão abaixo para
                  criar uma nova nota.
                </p>
                <button
                  onClick={() => {
                    cancelEditNote();
                    setNoteStage("form");
                  }}
                  className="rounded-lg bg-brand px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-brand-strong"
                >
                  Criar anotação
                </button>
              </div>
            )}
            {notesList && notesList.length > 0 && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                    {notesList.length} nota{notesList.length === 1 ? "" : "s"}
                  </h4>
                  <button
                    onClick={() => {
                      cancelEditNote();
                      setNoteStage("form");
                    }}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-strong"
                  >
                    + Nova
                  </button>
                </div>
                <div className="space-y-2">
                  {notesList.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] text-neutral-400">
                          {new Date(n.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => {
                              startEditNote(n);
                              setNoteStage("form");
                            }}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-brand"
                          >
                            <IconPencilMini />
                          </button>
                          <button
                            onClick={() => void removeNote(n.id)}
                            className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-red-600"
                          >
                            <IconTrashMini />
                          </button>
                        </div>
                      </div>
                      {n.body && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">
                          {n.body}
                        </p>
                      )}
                      {n.media_url && n.media_mime?.startsWith("image/") && (
                        <img
                          src={n.media_url}
                          alt=""
                          className="mt-2 max-h-40 rounded-lg object-cover"
                        />
                      )}
                      {n.media_url && n.media_mime?.startsWith("video/") && (
                        <video src={n.media_url} controls className="mt-2 max-h-40 rounded-lg" />
                      )}
                      {n.media_url && n.media_mime?.startsWith("audio/") && (
                        <audio src={n.media_url} controls className="mt-2 h-8 w-full" />
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {tab === "notes" && noteStage === "form" && (
          <div className="space-y-2">
            <label className="mb-1 block text-xs font-bold text-neutral-700">
              Adicione uma mídia na anotação
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-600 hover:border-brand">
              <input
                ref={noteFileRef}
                type="file"
                accept="image/*,audio/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickNoteFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => noteFileRef.current?.click()}
                className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1"
              >
                Escolher arquivo
              </button>
              <span className="truncate">
                {noteUploaded ? noteUploaded.filename : "Imagem, áudio ou vídeo (opcional)"}
              </span>
            </label>
            <label className="mb-1 mt-3 block text-xs font-bold text-neutral-700">
              Insira uma anotação
            </label>
            <textarea
              value={newNoteBody}
              onChange={(e) => setNewNoteBody(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Escreva sua nota..."
              className={inputCls}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  cancelEditNote();
                  setNoteStage("list");
                }}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (await addNote()) setNoteStage("list");
                }}
                disabled={busy || (!newNoteBody.trim() && !noteUploaded)}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
              >
                {busy ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}

        {tab === "schedule" && scheduleStage === "list" && (
          <>
            {jobsList === null && (
              <p className="py-6 text-center text-sm text-neutral-400">Carregando...</p>
            )}
            {jobsList?.length === 0 && (
              <div className="flex flex-col items-center px-2 pb-2 pt-7 text-center">
                <div className="mb-3.5 text-neutral-300">
                  <svg
                    width="44"
                    height="44"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 9.5h11" />
                    <path d="M14.5 4.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10" />
                    <path d="M8 3v3M12 3v3" />
                    <circle cx="16.5" cy="15.5" r="5" />
                    <path d="M16.5 13v2.5l1.7 1" />
                  </svg>
                </div>
                <p className="mb-2 text-base font-extrabold text-neutral-900">
                  Nenhum agendamento encontrado
                </p>
                <p className="mb-5 max-w-xs text-[13px] leading-relaxed text-neutral-500">
                  Não há agendamentos programados no momento. Para adicionar um novo, clique no
                  botão de criação.
                </p>
                <button
                  onClick={() => {
                    resetScheduleForm();
                    setScheduleStage("form");
                  }}
                  className="rounded-lg bg-brand px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-brand-strong"
                >
                  Adicionar
                </button>
              </div>
            )}
            {jobsList && jobsList.length > 0 && (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-neutral-400">
                    {jobsList.length} agendamento{jobsList.length === 1 ? "" : "s"}
                  </h4>
                  <button
                    onClick={() => {
                      resetScheduleForm();
                      setScheduleStage("form");
                    }}
                    className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-strong"
                  >
                    + Novo
                  </button>
                </div>
                <div className="space-y-2">
                  {jobsList.map((j) => {
                    const mediaActions = (j.message_actions || []).filter(
                      (a) => a.type !== "text" && a.url,
                    );
                    return (
                      <div
                        key={j.id}
                        className="rounded-xl border border-neutral-200 bg-neutral-50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] text-neutral-400">
                            {new Date(j.scheduled_for).toLocaleString("pt-BR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            <span
                              className={
                                "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase " +
                                (j.status === "sent"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : j.status === "failed"
                                    ? "bg-red-100 text-red-600"
                                    : "bg-blue-100 text-blue-700")
                              }
                            >
                              {j.status === "sent"
                                ? "Enviada"
                                : j.status === "failed"
                                  ? "Falhou"
                                  : "Agendada"}
                            </span>
                          </p>
                          <div className="flex shrink-0 gap-1">
                            {j.status === "pending" && (
                              <button
                                onClick={() => {
                                  startEditJob(j);
                                  setScheduleStage("form");
                                }}
                                className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-brand"
                              >
                                <IconPencilMini />
                              </button>
                            )}
                            <button
                              onClick={() => void cancelJob(j.id)}
                              className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-red-600"
                            >
                              <IconTrashMini />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-800">
                          {j.rendered_body}
                        </p>
                        {mediaActions.map((a, i) => (
                          <div key={i}>
                            {a.type === "image" && a.url && (
                              <img
                                src={a.url}
                                alt=""
                                className="mt-2 max-h-40 rounded-lg object-cover"
                              />
                            )}
                            {a.type === "video" && a.url && (
                              <video src={a.url} controls className="mt-2 max-h-40 rounded-lg" />
                            )}
                            {a.type === "audio" && a.url && (
                              <audio src={a.url} controls className="mt-2 h-8 w-full" />
                            )}
                          </div>
                        ))}
                        {j.status === "failed" && j.last_error && (
                          <p className="mt-1 text-xs text-red-500">{j.last_error}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {tab === "schedule" && scheduleStage === "form" && (
          <div className="space-y-2">
            <div className="mb-3 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1">
              {(
                [
                  { key: "text", label: "Texto" },
                  { key: "image", label: "Imagem" },
                  { key: "audio", label: "Áudio" },
                  { key: "qr", label: "Resposta rápida" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setScheduleType(t.key);
                    if (t.key === "qr") void ensureQuickReplies();
                  }}
                  className={
                    "flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-bold transition-colors " +
                    (scheduleType === t.key
                      ? "bg-brand text-white"
                      : "text-neutral-500 hover:bg-neutral-100")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            {scheduleType === "text" && (
              <textarea
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder="Digite a mensagem que será enviada..."
                className={inputCls}
              />
            )}

            {(scheduleType === "image" || scheduleType === "audio") && (
              <>
                <label className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-600 hover:border-brand">
                  <input
                    ref={scheduleFileRef}
                    type="file"
                    accept={`${scheduleType}/*`}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPickScheduleFile(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => scheduleFileRef.current?.click()}
                    className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1"
                  >
                    Escolher arquivo
                  </button>
                  <span className="truncate">
                    {scheduleUploaded
                      ? scheduleUploaded.filename
                      : `Arquivo de ${scheduleType === "image" ? "imagem" : "áudio"}`}
                  </span>
                </label>
                {scheduleType === "image" && (
                  <input
                    value={scheduleCaption}
                    onChange={(e) => setScheduleCaption(e.target.value)}
                    placeholder="Legenda (opcional)"
                    className={inputCls}
                  />
                )}
              </>
            )}

            {scheduleType === "qr" && (
              <>
                <select
                  value={scheduleQrId}
                  onChange={(e) => setScheduleQrId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Escolha uma resposta rápida...</option>
                  {availableQuickReplies?.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
                </select>
                {availableQuickReplies?.length === 0 && (
                  <p className="text-xs text-neutral-400">
                    Nenhuma resposta rápida cadastrada ainda.
                  </p>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={when.split("T")[0] || ""}
                onChange={(e) => setWhen(`${e.target.value}T${when.split("T")[1] || "00:00"}`)}
                className={inputCls}
              />
              <input
                type="time"
                value={when.split("T")[1] || ""}
                onChange={(e) =>
                  setWhen(
                    `${when.split("T")[0] || new Date().toISOString().slice(0, 10)}T${e.target.value}`,
                  )
                }
                className={inputCls}
              />
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  resetScheduleForm();
                  setScheduleStage("list");
                }}
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (await schedule()) setScheduleStage("list");
                }}
                disabled={busy}
                className="rounded-lg bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
              >
                {busy ? "Salvando..." : editingJobId ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>
        )}

        {tab === "profile" && (
          <div className="space-y-3">
            {!contactQuery && (
              <p className="text-sm text-neutral-500">
                Sem telefone/contato vinculado a esse lead.
              </p>
            )}
            {contactQuery && !profileLoaded && (
              <p className="text-sm text-neutral-400">Carregando...</p>
            )}
            {contactQuery && profileLoaded && profile && deal && (
              <>
                <div className="mb-1 flex items-center gap-3">
                  {card.profile_picture_url ? (
                    <img
                      src={card.profile_picture_url}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-base font-bold text-white">
                      {((profile.name as string) || card.title || "?")
                        .trim()
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <input
                        className="min-w-0 flex-1 border-0 border-b border-transparent bg-transparent py-0.5 text-sm font-extrabold text-neutral-900 outline-none transition-colors hover:border-neutral-200 focus:border-brand"
                        value={(profile.name as string) ?? ""}
                        placeholder="Nome do contato"
                        onChange={(e) => {
                          setProfile({ ...profile, name: e.target.value });
                          setCpDirty(true);
                        }}
                      />
                      <span className="shrink-0 text-neutral-300">
                        <IconPencilMini />
                      </span>
                    </div>
                    <p className="text-xs text-neutral-500">{card.phone}</p>
                  </div>
                </div>

                <Field label="Email">
                  <input
                    className={inputCls}
                    value={(profile.email as string) ?? ""}
                    onChange={(e) => {
                      setProfile({ ...profile, email: e.target.value });
                      setCpDirty(true);
                    }}
                    placeholder="email@exemplo.com"
                  />
                </Field>
                <Field label="Sexo">
                  <select
                    className={inputCls}
                    value={(profile.gender as string) ?? ""}
                    onChange={(e) => {
                      setProfile({ ...profile, gender: e.target.value });
                      setCpDirty(true);
                    }}
                  >
                    <option value="">Selecione um sexo</option>
                    <option value="feminino">Feminino</option>
                    <option value="masculino">Masculino</option>
                    <option value="outro">Outro</option>
                    <option value="prefiro_nao_dizer">Prefiro não dizer</option>
                  </select>
                </Field>
                <Field label="Data de nascimento">
                  <input
                    type="date"
                    className={inputCls}
                    value={(profile.birth_date as string) ?? ""}
                    onChange={(e) => {
                      setProfile({ ...profile, birth_date: e.target.value });
                      setCpDirty(true);
                    }}
                  />
                </Field>
                <Field label="Cidade">
                  <input
                    className={inputCls}
                    value={(profile.city as string) ?? ""}
                    onChange={(e) => {
                      setProfile({ ...profile, city: e.target.value });
                      setCpDirty(true);
                    }}
                  />
                </Field>

                <div className="my-1 border-t border-neutral-100" />

                <Field label="Origem do lead">
                  <input
                    className={inputCls}
                    value={(deal.lead_source as string) ?? ""}
                    onChange={(e) => {
                      setDeal({ ...deal, lead_source: e.target.value });
                      setCpDirty(true);
                    }}
                    placeholder="Ex: Instagram, indicação..."
                  />
                </Field>
                <Field label="Estágio do contato">
                  <input
                    className={inputCls}
                    value={(deal.stage_label as string) ?? ""}
                    onChange={(e) => {
                      setDeal({ ...deal, stage_label: e.target.value });
                      setCpDirty(true);
                    }}
                    placeholder="Ex: Qualificando"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Data de entrada">
                    <input
                      type="date"
                      className={inputCls}
                      value={(deal.entry_date as string) ?? ""}
                      onChange={(e) => {
                        setDeal({ ...deal, entry_date: e.target.value });
                        setCpDirty(true);
                      }}
                    />
                  </Field>
                  <Field label="Data de saída">
                    <input
                      type="date"
                      className={inputCls}
                      value={(deal.exit_date as string) ?? ""}
                      onChange={(e) => {
                        setDeal({ ...deal, exit_date: e.target.value });
                        setCpDirty(true);
                      }}
                    />
                  </Field>
                </div>
                <Field label="Valor do negócio (R$)">
                  <div className="flex items-center gap-2">
                    <IconDeal />
                    <input
                      className={inputCls}
                      value={dealValueText}
                      onChange={(e) => {
                        setDealValueText(e.target.value);
                        setCpDirty(true);
                      }}
                      placeholder="0,00"
                      inputMode="decimal"
                    />
                  </div>
                </Field>
                <Field label="Produto de interesse">
                  <input
                    className={inputCls}
                    value={(deal.products_of_interest as string) ?? ""}
                    onChange={(e) => {
                      setDeal({ ...deal, products_of_interest: e.target.value });
                      setCpDirty(true);
                    }}
                  />
                </Field>
                <Field label="Observações">
                  <textarea
                    rows={3}
                    className={inputCls}
                    value={(deal.notes as string) ?? ""}
                    onChange={(e) => {
                      setDeal({ ...deal, notes: e.target.value });
                      setCpDirty(true);
                    }}
                    placeholder="Adicione uma observação"
                  />
                </Field>

                <button
                  onClick={saveProfile}
                  disabled={cpBusy || !cpDirty}
                  className="w-full rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
                >
                  {cpBusy ? "Salvando..." : "Salvar"}
                </button>
              </>
            )}
          </div>
        )}

        {err && <p className="text-sm text-red-500">{err}</p>}
      </div>
    </Overlay>
  );
}
