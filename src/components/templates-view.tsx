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
  const [headerFormat, setHeaderFormat] = useState<"" | "IMAGE" | "VIDEO" | "DOCUMENT">("");
  const [headerFile, setHeaderFile] = useState<{ dataUrl: string; mime: string; filename: string } | null>(null);

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
    setSaving(true);
    setErr(null);
    const res = await api("/api/public/extension/whatsapp/templates", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        category,
        language_code: languageCode,
        body_text: bodyText.trim(),
        ...(headerFormat && headerFile
          ? {
              header_format: headerFormat,
              header_data_base64: headerFile.dataUrl,
              header_mime: headerFile.mime,
              header_filename: headerFile.filename,
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
    setHeaderFormat("");
    setHeaderFile(null);
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
              Texto do modelo (use {"{{1}}"}, {"{{2}}"}... pra variáveis)
            </label>
            <textarea
              className={inputCls}
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Olá {{1}}, seu horário está confirmado para {{2}}."
            />
          </div>
          <button
            onClick={() => void createTemplate()}
            disabled={saving || !name.trim() || !bodyText.trim() || (!!headerFormat && !headerFile)}
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
