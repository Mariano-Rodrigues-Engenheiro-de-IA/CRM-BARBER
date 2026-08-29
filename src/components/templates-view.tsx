// Gestão de modelos de mensagem (message templates) — só admin, por
// enquanto. Cria e lista templates direto pela API da Meta, sem precisar
// entrar no Gerenciador do WhatsApp.

import { useState } from "react";
import { useCachedFetch } from "@/lib/api-cache";

type ApiFn = (path: string, opts?: RequestInit) => Promise<Record<string, unknown>>;

type Template = {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string | null;
};

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

export function TemplatesView({ api }: { api: ApiFn }) {
  const { data: templates, loading, refetch } = useCachedFetch<Template[]>("templates", async () => {
    const res = await api("/api/public/extension/whatsapp/templates");
    if (!res.ok) throw new Error((res.error as string) || "Falha ao carregar modelos.");
    return (res.templates as Template[]) ?? [];
  });
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [languageCode, setLanguageCode] = useState("pt_BR");
  const [bodyText, setBodyText] = useState("");
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [headerFormat, setHeaderFormat] = useState<"" | "IMAGE" | "VIDEO" | "DOCUMENT">("");
  const [headerFile, setHeaderFile] = useState<{ dataUrl: string; mime: string; filename: string } | null>(null);

  type CarouselButton = { type: "URL" | "QUICK_REPLY"; text: string; url?: string };
  type CarouselCard = {
    file: { dataUrl: string; mime: string; filename: string } | null;
    bodyText: string;
    buttons: CarouselButton[];
  };
  const [useCarousel, setUseCarousel] = useState(false);
  const [carouselFormat, setCarouselFormat] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [carouselCards, setCarouselCards] = useState<CarouselCard[]>([
    { file: null, bodyText: "", buttons: [] },
    { file: null, bodyText: "", buttons: [] },
  ]);

  function addCarouselCard() {
    if (carouselCards.length >= 10) return;
    setCarouselCards((prev) => [...prev, { file: null, bodyText: "", buttons: [] }]);
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

  async function onPickHeaderFile(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
    setHeaderFile({ dataUrl, mime: file.type, filename: file.name });
  }

  async function createTemplate() {
    if (!name.trim() || !bodyText.trim()) return;
    if (headerFormat && !headerFile) {
      setErr("Escolha um arquivo para o cabeçalho, ou volte o tipo de cabeçalho pra \"Nenhum\".");
      return;
    }
    if (varNames.some((v) => !bodyExamples[v]?.trim())) {
      setErr("Preencha um valor de exemplo para cada variável — a Meta exige isso pra analisar o modelo.");
      return;
    }
    if (useCarousel) {
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
    setSaving(true);
    setErr(null);
    const res = await api("/api/public/extension/whatsapp/templates", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        category,
        language_code: languageCode,
        body_text: bodyText.trim(),
        ...(varNames.length ? { body_examples: bodyExamples } : {}),
        ...(headerFormat && headerFile
          ? {
              header_format: headerFormat,
              header_data_base64: headerFile.dataUrl,
              header_mime: headerFile.mime,
              header_filename: headerFile.filename,
            }
          : {}),
        ...(useCarousel
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
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((res.error as string) || "Falha ao criar modelo.");
      return;
    }
    setName("");
    setBodyText("");
    setBodyExamples({});
    setHeaderFormat("");
    setHeaderFile(null);
    setUseCarousel(false);
    setCarouselCards([
      { file: null, bodyText: "", buttons: [] },
      { file: null, bodyText: "", buttons: [] },
    ]);
    setCarouselButtons([]);
    setShowNew(false);
    void refetch();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">Modelos de mensagem</h1>
          <p className="mt-1 text-xs text-neutral-500">
            Templates aprovados pela Meta, gerenciados direto por aqui — sem precisar entrar no site deles.
          </p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-white hover:bg-brand-strong"
        >
          {showNew ? "Cancelar" : "Novo modelo"}
        </button>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>
      )}

      {showNew && (
        <div className="space-y-3 rounded-xl border border-neutral-300 bg-white p-5 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700">
              Nome (só letras minúsculas, números e _ — sem espaço/acento)
            </label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="lembrete_agendamento"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-700">Categoria</label>
              <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
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
            <label className="mb-1 block text-xs font-medium text-neutral-700">Cabeçalho (opcional)</label>
            <select
              className={inputCls}
              value={headerFormat}
              onChange={(e) => {
                setHeaderFormat(e.target.value as typeof headerFormat);
                setHeaderFile(null);
              }}
            >
              <option value="">Nenhum — só texto</option>
              <option value="IMAGE">Imagem</option>
              <option value="VIDEO">Vídeo</option>
              <option value="DOCUMENT">Documento (PDF)</option>
            </select>
            {headerFormat && (
              <label className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-600 hover:border-brand">
                <input
                  type="file"
                  accept={headerFormat === "IMAGE" ? "image/jpeg,image/png" : headerFormat === "VIDEO" ? "video/mp4,video/3gpp" : "application/pdf"}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPickHeaderFile(f);
                  }}
                />
                <span className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1">Escolher arquivo</span>
                <span className="truncate">{headerFile ? headerFile.filename : "Nenhum arquivo escolhido"}</span>
              </label>
            )}
            <p className="mt-1 text-[11px] text-neutral-400">
              Aqui você só escolhe o TIPO de mídia do cabeçalho — a Meta pede um arquivo de exemplo pra aprovar o
              modelo, mas na hora de enviar de verdade pra cada cliente, você poderá usar qualquer imagem/vídeo/documento
              daquele tipo.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-700">
              Texto do modelo (use {"{{nome}}"}, {"{{data}}"}... pra variáveis — minúsculas, sem espaço/acento)
            </label>
            <textarea
              className={inputCls}
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Olá {{nome}}, seu horário está confirmado para {{data}} às {{hora}}."
            />
          </div>
          {varNames.length > 0 && (
            <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-xs font-medium text-neutral-700">
                Valor de exemplo pra cada variável (a Meta exige isso pra analisar o modelo — não é o que será
                enviado de verdade, só um exemplo)
              </p>
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

          {category === "MARKETING" && (
            <div className="space-y-3 rounded-lg border border-neutral-200 p-3">
              <label className="flex items-center gap-2 text-xs font-medium text-neutral-700">
                <input type="checkbox" checked={useCarousel} onChange={(e) => setUseCarousel(e.target.checked)} />
                Adicionar carrossel (cartões que o cliente arrasta pro lado — só disponível aqui, a Meta nem oferece
                isso na tela dela)
              </label>

              {useCarousel && (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-700">Tipo de mídia dos cartões</label>
                    <select className={inputCls} value={carouselFormat} onChange={(e) => setCarouselFormat(e.target.value as "IMAGE" | "VIDEO")}>
                      <option value="IMAGE">Imagem</option>
                      <option value="VIDEO">Vídeo</option>
                    </select>
                    <p className="mt-1 text-[11px] text-neutral-400">Todos os cartões precisam ter o mesmo tipo — regra da Meta.</p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-700">
                      Botões dos cartões (opcional, até 2 — iguais em todos os cartões)
                    </label>
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
                    <label className="block text-xs font-medium text-neutral-700">
                      Cartões ({carouselCards.length} de 10 — mínimo 2)
                    </label>
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
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => void createTemplate()}
            disabled={
              saving ||
              !name.trim() ||
              !bodyText.trim() ||
              (!!headerFormat && !headerFile) ||
              varNames.some((v) => !bodyExamples[v]?.trim()) ||
              (useCarousel && carouselCards.some((c) => !c.file))
            }
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Enviando pra análise…" : "Enviar pra aprovação"}
          </button>
          <p className="text-[11px] text-neutral-500">
            A Meta analisa o modelo antes de liberar — geralmente minutos, podendo levar até ~24h.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-neutral-300 bg-white shadow-sm">
        {loading ? (
          <div className="p-6 text-center text-xs text-neutral-500">Carregando…</div>
        ) : !templates || templates.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">Nenhum modelo criado ainda.</div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{t.name}</p>
                  <p className="text-[11px] text-neutral-500">
                    {t.category} · {t.language}
                    {t.status === "REJECTED" && t.rejected_reason ? ` · ${t.rejected_reason}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[t.status] ?? "bg-neutral-200 text-neutral-700"}`}
                >
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
