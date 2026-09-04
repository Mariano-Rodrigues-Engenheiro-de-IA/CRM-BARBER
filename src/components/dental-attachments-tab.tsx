// Anexos do prontuário — fichas antigas, radiografia, qualquer
// documento do paciente. Bucket privado no Supabase, URL assinada por
// arquivo (não fica público na internet).

import { useEffect, useRef, useState } from "react";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type Attachment = {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  url: string | null;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(contentType: string) {
  return contentType.startsWith("image/");
}

function isPdf(contentType: string) {
  return contentType === "application/pdf";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Corta o prefixo "data:tipo;base64," — só o conteúdo em si.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function FileIcon({ contentType }: { contentType: string }) {
  if (isPdf(contentType)) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <text x="7" y="18" fontSize="6" fill="currentColor" stroke="none">PDF</text>
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function DentalAttachmentsTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const res = await api(`/api/public/extension/dental-attachments?customer_id=${encodeURIComponent(customerId)}`);
    if (res?.ok) setAttachments(res.attachments || []);
    else setErr("Não consegui carregar os anexos agora.");
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function uploadFiles(files: FileList | File[]) {
    setErr(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        setErr(`"${file.name}" passa de 10MB. Não deu pra enviar.`);
        continue;
      }
      setUploading(true);
      try {
        const base64 = await fileToBase64(file);
        const res = await api("/api/public/extension/dental-attachments", {
          method: "POST",
          body: JSON.stringify({
            customer_id: customerId,
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
            base64,
          }),
        });
        if (res?.ok) {
          setAttachments((prev) => [...prev, res.attachment]);
        } else {
          setErr(res?.error || `Não consegui enviar "${file.name}".`);
        }
      } catch {
        setErr(`Não consegui enviar "${file.name}".`);
      } finally {
        setUploading(false);
      }
    }
  }

  async function removeAttachment(id: string) {
    const res = await api(`/api/public/extension/dental-attachments/${id}`, { method: "DELETE" });
    if (res?.ok) setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  if (loading) return <p className="text-sm text-neutral-400">Carregando anexos...</p>;

  return (
    <div className="space-y-3 print:hidden">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 text-center transition ${
          dragOver ? "border-brand bg-brand/5" : "border-neutral-300 hover:border-neutral-400"
        }`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-neutral-400">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <p className="text-sm font-medium text-neutral-700">
          {uploading ? "Enviando..." : "Arraste um arquivo aqui, ou clique pra escolher"}
        </p>
        <p className="text-xs text-neutral-400">Radiografia, ficha antiga, qualquer documento. Até 10MB.</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {attachments.length === 0 ? (
        <p className="text-sm text-neutral-400">Nenhum anexo enviado ainda.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((a, i) => (
            <div key={a.id} className="group relative overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <a
                href={a.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block"
              >
                {isImage(a.content_type) && a.url ? (
                  <img src={a.url} alt={a.file_name} className="h-28 w-full object-cover" />
                ) : (
                  <div className="flex h-28 w-full items-center justify-center bg-neutral-50 text-neutral-400">
                    <FileIcon contentType={a.content_type} />
                  </div>
                )}
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-neutral-800">
                    {i + 1}. {a.file_name}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {new Date(a.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                    {" · "}
                    {formatSize(a.size_bytes)}
                  </p>
                </div>
              </a>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                title="Remover"
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-neutral-500 opacity-0 shadow-sm transition hover:text-red-600 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
