// Gestão de modelos de mensagem (message templates) — só admin, por
// enquanto. Cria e lista templates direto pela API da Meta, sem precisar
// entrar no Gerenciador do WhatsApp.

import { useState } from "react";
import { useCachedFetch } from "@/lib/api-cache";
import { useConfirm } from "@/components/confirm-dialog";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

type TemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
};

type Template = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string | null;
  last_updated_time?: string | null;
  components?: TemplateComponent[];
};

const LANGUAGE_LABEL: Record<string, string> = {
  pt_BR: "Português (Brasil)",
  en_US: "Inglês (EUA)",
};

/** Decodifica os componentes crus da Meta de volta pros campos do
 * formulário, pra edição — reconstrói tudo, exceto a mídia em si (o
 * cabeçalho fica mantido a menos que a pessoa escolha um arquivo novo). */
function decomposeTemplate(t: Template) {
  const comps = t.components ?? [];
  const header = comps.find((c) => c.type?.toUpperCase() === "HEADER");
  const body = comps.find((c) => c.type?.toUpperCase() === "BODY");
  const footer = comps.find((c) => c.type?.toUpperCase() === "FOOTER");
  const buttonsComp = comps.find((c) => c.type?.toUpperCase() === "BUTTONS");
  const hasCarousel = comps.some((c) => c.type?.toUpperCase() === "CAROUSEL");

  const headerFormat = header?.format?.toUpperCase();
  const templateType: "text" | "image" | "video" | "document" =
    headerFormat === "IMAGE" ? "image" : headerFormat === "VIDEO" ? "video" : headerFormat === "DOCUMENT" ? "document" : "text";

  const buttons = (buttonsComp?.buttons ?? []).map((b) => {
    const type = b.type?.toUpperCase();
    if (type === "URL") return { type: "URL" as const, text: b.text, url: b.url ?? "" };
    if (type === "PHONE_NUMBER") return { type: "PHONE_NUMBER" as const, text: b.text, phone_number: b.phone_number ?? "" };
    return { type: "QUICK_REPLY" as const, text: b.text };
  });

  return {
    hasCarousel,
    templateType,
    bodyText: body?.text ?? "",
    footerText: footer?.text ?? "",
    buttons,
  };
}

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-brand";

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  REJECTED: "bg-red-100 text-red-800",
  PAUSED: "bg-neutral-200 text-neutral-700",
  DISABLED: "bg-neutral-200 text-neutral-700",
};

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em análise",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export function TemplatesView({ api }: { api: ApiFn }) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { data: templates, loading, refetch } = useCachedFetch<Template[]>("templates", async () => {
    const res = await api("/api/public/extension/whatsapp/templates");
    if (!res.ok) throw new Error((res.error as string) || "Falha ao carregar modelos.");
    return (res.templates as Template[]) ?? [];
  });
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  // null = criando um modelo novo; string = editando o modelo com esse id
  // (o nome não pode mudar, e a Meta não permite editar carrossel por
  // esse mesmo endpoint — só criar um novo).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [languageCode, setLanguageCode] = useState("pt_BR");
  const [bodyText, setBodyText] = useState("");
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [footerText, setFooterText] = useState("");

  // Botões do modelo (Texto/Imagem/Vídeo/Documento) — até 3, qualquer
  // mistura de tipos. O carrossel tem os botões dele próprio, separados.
  type TemplateButton =
    | { type: "QUICK_REPLY"; text: string }
    | { type: "URL"; text: string; url: string }
    | { type: "PHONE_NUMBER"; text: string; phone_number: string };
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  function addButton() {
    if (buttons.length >= 3) return;
    setButtons((prev) => [...prev, { type: "QUICK_REPLY", text: "" }]);
  }
  function updateButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((prev) => prev.map((b, bi) => (bi === i ? ({ ...b, ...patch } as TemplateButton) : b)));
  }

  // Tipo do modelo — escolha única e exclusiva. Cada tipo mostra só os
  // campos dele; nada se mistura ou se reaproveita entre tipos.
  type TemplateType = "text" | "image" | "video" | "document" | "carousel";
  const [templateType, setTemplateType] = useState<TemplateType>("text");
  const TYPE_OPTIONS: { key: TemplateType; label: string }[] = [
    { key: "text", label: "Texto" },
    { key: "image", label: "Imagem" },
    { key: "video", label: "Vídeo" },
    { key: "document", label: "Documento" },
    { key: "carousel", label: "Carrossel" },
  ];

  // Imagem / Vídeo / Documento — um arquivo só, mesmo campo pros três.
  const [mediaFile, setMediaFile] = useState<{ dataUrl: string; mime: string; filename: string } | null>(null);
  async function onPickMediaFile(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
    setMediaFile({ dataUrl, mime: file.type, filename: file.name });
  }
  const mediaAccept =
    templateType === "image" ? "image/jpeg,image/png" : templateType === "video" ? "video/mp4,video/3gpp" : "application/pdf";

  // Carrossel — só existe dentro do próprio tipo "Carrossel", não é mais
  // um complemento opcional de outro tipo.
  type CarouselButton = { type: "URL" | "QUICK_REPLY"; text: string; url?: string };
  type CarouselCard = {
    file: { dataUrl: string; mime: string; filename: string } | null;
    bodyText: string;
  };
  const [carouselFormat, setCarouselFormat] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [carouselCards, setCarouselCards] = useState<CarouselCard[]>([
    { file: null, bodyText: "" },
    { file: null, bodyText: "" },
  ]);

  function addCarouselCard() {
    if (carouselCards.length >= 10) return;
    setCarouselCards((prev) => [...prev, { file: null, bodyText: "" }]);
  }
  function removeCarouselCard(idx: number) {
    if (carouselCards.length <= 2) return;
    setCarouselCards((prev) => prev.filter((_, i) => i !== idx));
  }
  async function onPickCarouselFile(idx: number, file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
    setCarouselCards((prev) => prev.map((c, i) => (i === idx ? { ...c, file: { dataUrl, mime: file.type, filename: file.name } } : c)));
  }
  // Botões precisam ser iguais (tipo e quantidade) em todos os cartões —
  // regra da própria Meta — então edita todos juntos, não card por card.
  const [carouselButtons, setCarouselButtons] = useState<CarouselButton[]>([]);
  function addCarouselButton() {
    if (carouselButtons.length >= 2) return;
    setCarouselButtons((prev) => [...prev, { type: "QUICK_REPLY", text: "" }]);
  }

  // Detecta {{nome}}, {{data}}... conforme a pessoa digita — cada uma
  // precisa de um valor de exemplo (a Meta exige isso pra aprovar).
  const varNames = Array.from(new Set(Array.from(bodyText.matchAll(/\{\{([a-z0-9_]+)\}\}/g)).map((m) => m[1])));

  function resetForm() {
    setName("");
    setCategory("UTILITY");
    setBodyText("");
    setBodyExamples({});
    setFooterText("");
    setButtons([]);
    setTemplateType("text");
    setMediaFile(null);
    setCarouselCards([
      { file: null, bodyText: "" },
      { file: null, bodyText: "" },
    ]);
    setCarouselButtons([]);
    setEditingId(null);
  }

  function startEdit(t: Template) {
    const d = decomposeTemplate(t);
    if (d.hasCarousel) {
      setErr("Carrossel não dá pra editar por aqui — cria um modelo novo e exclui o antigo, se quiser trocar.");
      return;
    }
    resetForm();
    setEditingId(t.id);
    setName(t.name);
    setCategory((t.category?.toUpperCase() as typeof category) || "UTILITY");
    setLanguageCode(t.language);
    setTemplateType(d.templateType);
    setBodyText(d.bodyText);
    setFooterText(d.footerText);
    setButtons(d.buttons);
    setShowNew(true);
    setErr(null);
  }

  async function removeTemplate(name: string) {
    setDeletingName(name);
    const r = await api(`/api/public/extension/whatsapp/templates?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    setDeletingName(null);
    if (!r.ok) {
      setErr((r.error as string) || "Falha ao excluir modelo.");
      return;
    }
    void refetch();
  }

  async function createTemplate() {
    if (!name.trim() || !bodyText.trim()) return;
    if ((templateType === "image" || templateType === "video" || templateType === "document") && !mediaFile && !editingId) {
      setErr("Escolha um arquivo.");
      return;
    }
    if (varNames.some((v) => !bodyExamples[v]?.trim())) {
      setErr("Preencha um valor de exemplo para cada variável. A Meta exige isso pra analisar o modelo.");
      return;
    }
    if (templateType === "carousel") {
      if (category !== "MARKETING") {
        setErr("Carrossel só é suportado em modelos da categoria Marketing.");
        return;
      }
      if (carouselCards.some((c) => !c.file)) {
        setErr("Escolha uma mídia para todos os cartões do carrossel.");
        return;
      }
      if (carouselButtons.some((b) => !b.text.trim() || (b.type === "URL" && !b.url?.trim()))) {
        setErr("Preencha o texto (e o link, se for botão de URL) de todos os botões do carrossel.");
        return;
      }
    }
    if (templateType !== "carousel" && buttons.some((b) => !b.text.trim() || (b.type === "URL" && !b.url.trim()) || (b.type === "PHONE_NUMBER" && !b.phone_number.trim()))) {
      setErr("Preencha todos os campos de cada botão.");
      return;
    }
    setSaving(true);
    setErr(null);
    const headerFormatByType: Record<string, string> = { image: "IMAGE", video: "VIDEO", document: "DOCUMENT" };
    const payload = {
      name: name.trim(),
      category,
      language_code: languageCode,
      body_text: bodyText.trim(),
      ...(varNames.length ? { body_examples: bodyExamples } : {}),
      ...(mediaFile && headerFormatByType[templateType]
        ? {
            header_format: headerFormatByType[templateType],
            header_data_base64: mediaFile.dataUrl,
            header_mime: mediaFile.mime,
            header_filename: mediaFile.filename,
          }
        : {}),
      ...(templateType !== "carousel" && footerText.trim() ? { footer_text: footerText.trim() } : {}),
      ...(templateType !== "carousel" && buttons.length > 0 ? { buttons } : {}),
      ...(templateType === "carousel"
        ? {
            carousel_cards: carouselCards.map((c) => ({
              header_format: carouselFormat,
              header_data_base64: c.file?.dataUrl,
              header_mime: c.file?.mime,
              header_filename: c.file?.filename,
              body_text: c.bodyText.trim() || undefined,
              buttons: carouselButtons.length > 0 ? carouselButtons : undefined,
            })),
          }
        : {}),
    };
    const res = editingId
      ? await api(`/api/public/extension/whatsapp/templates/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await api("/api/public/extension/whatsapp/templates", { method: "POST", body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) {
      setErr((res.error as string) || `Falha ao ${editingId ? "editar" : "criar"} modelo.`);
      return;
    }
    resetForm();
    setShowNew(false);
    void refetch();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Modelos de mensagem</h1>
        </div>
        <button
          onClick={() => {
            if (showNew) resetForm();
            setShowNew((v) => !v);
          }}
          className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-strong"
        >
          {showNew ? "Cancelar" : "Novo modelo"}
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>
      )}

      {showNew && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-900">{editingId ? "Editar modelo" : "Novo modelo"}</h2>
            {editingId && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                Editando — volta pra análise ao salvar
              </span>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700">Nome</label>
            <input
              className={inputCls + (editingId ? " cursor-not-allowed bg-neutral-100 text-neutral-500" : "")}
              value={name}
              disabled={!!editingId}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="lembrete_agendamento"
            />
            {editingId && <p className="mt-1 text-[11px] text-neutral-400">O nome não pode ser alterado — crie um modelo novo se precisar de outro nome.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Categoria</label>
              <select
                className={inputCls}
                value={category}
                onChange={(e) => {
                  const next = e.target.value as typeof category;
                  setCategory(next);
                  if (next !== "MARKETING" && templateType === "carousel") setTemplateType("text");
                }}
              >
                <option value="UTILITY">Utilidade (avisos, lembretes)</option>
                <option value="MARKETING">Marketing (promoções)</option>
                <option value="AUTHENTICATION">Autenticação (códigos)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Idioma</label>
              <select className={inputCls} value={languageCode} onChange={(e) => setLanguageCode(e.target.value)}>
                <option value="pt_BR">Português (Brasil)</option>
                <option value="en_US">Inglês (EUA)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-700">Tipo de modelo</label>
            <div className="grid grid-cols-5 gap-1.5">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setTemplateType(opt.key)}
                  disabled={opt.key === "carousel" && category !== "MARKETING"}
                  className={
                    "rounded-lg border px-2 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 " +
                    (templateType === opt.key
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-neutral-300 bg-white text-neutral-600 hover:border-brand/50")
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* TEXTO — só o corpo da mensagem, sem nenhuma mídia. */}
          {templateType === "text" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Texto</label>
              <textarea
                className={inputCls}
                rows={4}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Olá {{nome}}, seu horário está confirmado para {{data}} às {{hora}}."
              />
            </div>
          )}

          {/* IMAGEM / VÍDEO / DOCUMENTO — um arquivo + o corpo da mensagem. */}
          {(templateType === "image" || templateType === "video" || templateType === "document") && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">
                  Arquivo ({templateType === "image" ? "imagem" : templateType === "video" ? "vídeo" : "PDF"})
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 hover:border-brand">
                  <input
                    type="file"
                    accept={mediaAccept}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onPickMediaFile(f);
                    }}
                  />
                  <span className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1">Escolher arquivo</span>
                  <span className="truncate">
                    {mediaFile ? mediaFile.filename : editingId ? "Cabeçalho atual mantido" : "Nenhum arquivo escolhido"}
                  </span>
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Texto</label>
                <textarea
                  className={inputCls}
                  rows={4}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Olá {{nome}}, seu horário está confirmado para {{data}} às {{hora}}."
                />
              </div>
            </>
          )}

          {/* CARROSSEL — texto de introdução + cartões, cada um com sua
             própria mídia e texto. Nada se mistura com os outros tipos. */}
          {templateType === "carousel" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Texto (aparece acima do carrossel)</label>
                <textarea
                  className={inputCls}
                  rows={3}
                  value={bodyText}
                  onChange={(e) => setBodyText(e.target.value)}
                  placeholder="Oferta especial só até {{data}}!"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Tipo de mídia dos cartões</label>
                <select className={inputCls} value={carouselFormat} onChange={(e) => setCarouselFormat(e.target.value as "IMAGE" | "VIDEO")}>
                  <option value="IMAGE">Imagem</option>
                  <option value="VIDEO">Vídeo</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Botões dos cartões (opcional)</label>
                <div className="space-y-2">
                  {carouselButtons.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        className="w-32 shrink-0 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-xs"
                        value={b.type}
                        onChange={(e) =>
                          setCarouselButtons((prev) => prev.map((x, xi) => (xi === i ? { ...x, type: e.target.value as "URL" | "QUICK_REPLY" } : x)))
                        }
                      >
                        <option value="QUICK_REPLY">Resposta rápida</option>
                        <option value="URL">Link (URL)</option>
                      </select>
                      <input
                        className={inputCls}
                        placeholder="Texto do botão"
                        value={b.text}
                        onChange={(e) => setCarouselButtons((prev) => prev.map((x, xi) => (xi === i ? { ...x, text: e.target.value } : x)))}
                      />
                      {b.type === "URL" && (
                        <input
                          className={inputCls}
                          placeholder="https://..."
                          value={b.url ?? ""}
                          onChange={(e) => setCarouselButtons((prev) => prev.map((x, xi) => (xi === i ? { ...x, url: e.target.value } : x)))}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setCarouselButtons((prev) => prev.filter((_, xi) => xi !== i))}
                        className="shrink-0 rounded-lg border border-neutral-300 px-2 py-2 text-xs text-neutral-500 hover:bg-neutral-50"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                  {carouselButtons.length < 2 && (
                    <button
                      type="button"
                      onClick={addCarouselButton}
                      className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:border-brand"
                    >
                      + Adicionar botão
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-medium text-neutral-700">Cartões</label>
                {carouselCards.map((card, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-neutral-700">Cartão {i + 1}</p>
                      {carouselCards.length > 2 && (
                        <button type="button" onClick={() => removeCarouselCard(i)} className="text-[11px] text-red-600 hover:underline">
                          Remover cartão
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-600 hover:border-brand">
                      <input
                        type="file"
                        accept={carouselFormat === "IMAGE" ? "image/jpeg,image/png" : "video/mp4,video/3gpp"}
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void onPickCarouselFile(i, f);
                        }}
                      />
                      <span className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1">Escolher arquivo</span>
                      <span className="truncate">{card.file ? card.file.filename : "Nenhum arquivo escolhido"}</span>
                    </label>
                    <input
                      className={inputCls}
                      placeholder="Texto do cartão (opcional)"
                      value={card.bodyText}
                      onChange={(e) => setCarouselCards((prev) => prev.map((c2, ci) => (ci === i ? { ...c2, bodyText: e.target.value } : c2)))}
                    />
                  </div>
                ))}
                {carouselCards.length < 10 && (
                  <button
                    type="button"
                    onClick={addCarouselCard}
                    className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:border-brand"
                  >
                    + Adicionar cartão
                  </button>
                )}
              </div>
            </>
          )}

          {templateType !== "carousel" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Rodapé (opcional)</label>
                <input
                  className={inputCls}
                  value={footerText}
                  onChange={(e) => setFooterText(e.target.value.slice(0, 60))}
                  placeholder="Não responda esta mensagem"
                  maxLength={60}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-700">Botões (opcional, até 3)</label>
                <div className="space-y-2">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        className="w-36 shrink-0 rounded-lg border border-neutral-300 bg-white px-2 py-2 text-xs"
                        value={b.type}
                        onChange={(e) => {
                          const t = e.target.value as TemplateButton["type"];
                          if (t === "URL") updateButton(i, { type: "URL", url: "" } as Partial<TemplateButton>);
                          else if (t === "PHONE_NUMBER") updateButton(i, { type: "PHONE_NUMBER", phone_number: "" } as Partial<TemplateButton>);
                          else updateButton(i, { type: "QUICK_REPLY" } as Partial<TemplateButton>);
                        }}
                      >
                        <option value="QUICK_REPLY">Resposta rápida</option>
                        <option value="URL">Link (URL)</option>
                        <option value="PHONE_NUMBER">Ligar</option>
                      </select>
                      <input
                        className={inputCls}
                        placeholder="Texto do botão"
                        value={b.text}
                        onChange={(e) => updateButton(i, { text: e.target.value })}
                      />
                      {b.type === "URL" && (
                        <input
                          className={inputCls}
                          placeholder="https://..."
                          value={b.url}
                          onChange={(e) => updateButton(i, { url: e.target.value } as Partial<TemplateButton>)}
                        />
                      )}
                      {b.type === "PHONE_NUMBER" && (
                        <input
                          className={inputCls}
                          placeholder="+55 11 99999-9999"
                          value={b.phone_number}
                          onChange={(e) => updateButton(i, { phone_number: e.target.value } as Partial<TemplateButton>)}
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setButtons((prev) => prev.filter((_, bi) => bi !== i))}
                        className="shrink-0 rounded-lg border border-neutral-300 px-2 py-2 text-xs text-neutral-500 hover:bg-neutral-50"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
                  {buttons.length < 3 && (
                    <button
                      type="button"
                      onClick={addButton}
                      className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:border-brand"
                    >
                      + Adicionar botão
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {varNames.length > 0 && (
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-700">Valor de exemplo</p>
              {varNames.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 truncate rounded bg-neutral-200 px-2 py-1 text-center text-[11px] font-mono text-neutral-700">
                    {`{{${v}}}`}
                  </span>
                  <input
                    className={inputCls}
                    value={bodyExamples[v] ?? ""}
                    onChange={(e) => setBodyExamples((prev) => ({ ...prev, [v]: e.target.value }))}
                    placeholder={v === "nome" ? "Maria" : v.includes("data") ? "15/03" : v.includes("hora") ? "14:30" : "exemplo"}
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => void createTemplate()}
            disabled={
              saving ||
              !name.trim() ||
              !bodyText.trim() ||
              ((templateType === "image" || templateType === "video" || templateType === "document") && !mediaFile && !editingId) ||
              varNames.some((v) => !bodyExamples[v]?.trim()) ||
              (templateType === "carousel" && carouselCards.some((c) => !c.file))
            }
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? (editingId ? "Salvando…" : "Enviando pra análise…") : editingId ? "Salvar edição" : "Enviar pra aprovação"}
          </button>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <TemplatePreview
            templateType={templateType}
            mediaFile={mediaFile}
            bodyText={bodyText}
            bodyExamples={bodyExamples}
            footerText={footerText}
            buttons={buttons}
            carouselCards={carouselCards}
            carouselButtons={carouselButtons}
          />
        </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-center text-xs text-neutral-500">Carregando…</div>
        ) : !templates || templates.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">Nenhum modelo criado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2.5">Nome do modelo</th>
                  <th className="px-4 py-2.5">Categoria</th>
                  <th className="px-4 py-2.5">Idioma</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Última edição</th>
                  <th className="px-4 py-2.5 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {templates.map((t) => {
                  const d = decomposeTemplate(t);
                  return (
                    <tr key={t.id} className="align-top">
                      <td className="max-w-[220px] px-4 py-3">
                        <p className="truncate font-medium text-neutral-900">{t.name}</p>
                        {d.bodyText && <p className="truncate text-xs text-neutral-400">{d.bodyText}</p>}
                        {t.status === "REJECTED" && t.rejected_reason && (
                          <p className="truncate text-xs text-red-600">{t.rejected_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{CATEGORY_LABEL[t.category?.toUpperCase()] ?? t.category}</td>
                      <td className="px-4 py-3 text-neutral-700">{LANGUAGE_LABEL[t.language] ?? t.language}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[t.status] ?? "bg-neutral-200 text-neutral-700"}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-neutral-500">
                        {t.last_updated_time
                          ? new Date(t.last_updated_time).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(t)}
                            title="Editar"
                            className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Excluir "${t.name}"?`,
                                description: "Isso remove o modelo (e todos os idiomas dele) de vez — não dá pra desfazer.",
                                confirmLabel: "Excluir",
                                destructive: true,
                              });
                              if (ok) void removeTemplate(t.name);
                            }}
                            disabled={deletingName === t.name}
                            title="Excluir"
                            className="rounded-lg p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  );
}

/** Prévia ao vivo do modelo, no estilo balão do WhatsApp — mesma dinâmica
 * de "ir vendo o resultado final conforme monta" que a própria Meta usa
 * na criação de modelos dela. */
function TemplatePreview({
  templateType,
  mediaFile,
  bodyText,
  bodyExamples,
  footerText,
  buttons,
  carouselCards,
  carouselButtons,
}: {
  templateType: "text" | "image" | "video" | "document" | "carousel";
  mediaFile: { dataUrl: string; mime: string; filename: string } | null;
  bodyText: string;
  bodyExamples: Record<string, string>;
  footerText: string;
  buttons: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  carouselCards: Array<{ file: { dataUrl: string; mime: string; filename: string } | null; bodyText: string }>;
  carouselButtons: Array<{ type: string; text: string; url?: string }>;
}) {
  function renderBody(text: string) {
    const filled = text.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, v) => bodyExamples[v]?.trim() || `[${v}]`);
    return filled || "Sua mensagem aparece aqui…";
  }

  function ButtonIcon({ type }: { type: string }) {
    if (type === "URL")
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10 14 21 3M15 3h6v6M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      );
    if (type === "PHONE_NUMBER")
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 3a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c1 .3 2 .5 3 .7a2 2 0 0 1 1.6 2Z" />
        </svg>
      );
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 10h18M3 14h18M7 10v10M17 10v10M5 10V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" />
      </svg>
    );
  }

  function MediaBox({
    file,
    kind,
  }: {
    file: { dataUrl: string; mime: string; filename: string } | null;
    kind: "image" | "video" | "document";
  }) {
    if (kind === "image") {
      return file ? (
        <img src={file.dataUrl} alt="" className="block w-full rounded-t-lg" />
      ) : (
        <div className="flex h-48 w-full items-center justify-center rounded-t-lg bg-neutral-200 text-neutral-400">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </div>
      );
    }
    if (kind === "video") {
      return file ? (
        <video src={file.dataUrl} className="block w-full rounded-t-lg bg-black" controls />
      ) : (
        <div className="flex h-48 w-full items-center justify-center rounded-t-lg bg-neutral-200 text-neutral-400">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m10 8 6 4-6 4V8Z" />
            <rect x="2" y="4" width="20" height="16" rx="2" />
          </svg>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-t-lg bg-neutral-100 px-3 py-3 text-neutral-500">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="truncate text-xs">{file ? file.filename : "documento.pdf"}</span>
      </div>
    );
  }

  return (
    <div className="lg:sticky lg:top-4">
      <p className="mb-2 text-sm font-semibold text-neutral-900">Prévia do modelo</p>

      {/* Fundo do WhatsApp por trás do card — sem moldura de celular (isso
         ficou artificial), só o "papel de parede" do chat mesmo, igual a
         própria Meta mostra na tela de criação de modelo dela. */}
      <div className="rounded-xl bg-[#e5ddd5] p-4">
        <div className="mx-auto w-[280px] overflow-hidden rounded-lg bg-white shadow-md">
          {(templateType === "image" || templateType === "video" || templateType === "document") && (
            <MediaBox file={mediaFile} kind={templateType} />
          )}
          <div className="px-3 pb-2 pt-2.5">
            <p className="whitespace-pre-wrap text-[13.5px] leading-snug text-neutral-800">{renderBody(bodyText)}</p>
            {footerText && <p className="mt-1.5 text-[12px] text-neutral-400">{footerText}</p>}
            <p className="mt-1 text-right text-[10.5px] text-neutral-400">
              {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          {templateType !== "carousel" && buttons.length > 0 && (
            <div className="border-t border-neutral-100">
              {buttons.map((b, i) => (
                <div key={i} className="flex items-center justify-center gap-1.5 border-t border-neutral-100 py-2 text-[13px] text-blue-600 first:border-t-0">
                  <ButtonIcon type={b.type} />
                  {b.text || "Botão"}
                </div>
              ))}
            </div>
          )}
        </div>

        {templateType === "carousel" && (
          <div className="mx-auto mt-2 flex w-[280px] gap-2 overflow-x-auto pb-1">
            {carouselCards.map((card, i) => (
              <div key={i} className="w-32 shrink-0 overflow-hidden rounded-lg bg-white shadow-sm">
                <MediaBox file={card.file} kind="image" />
                {card.bodyText && <p className="px-2 py-1.5 text-[11px] text-neutral-800">{card.bodyText}</p>}
                {carouselButtons.length > 0 && (
                  <div className="border-t border-neutral-100">
                    {carouselButtons.map((b, bi) => (
                      <div key={bi} className="flex items-center justify-center gap-1 border-t border-neutral-100 py-1.5 text-[11px] text-blue-600 first:border-t-0">
                        <ButtonIcon type={b.type} />
                        {b.text || "Botão"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
