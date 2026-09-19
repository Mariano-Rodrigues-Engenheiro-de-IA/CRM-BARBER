// Preview visual de como a mensagem vai chegar pro destinatário — bolha
// de chat estilo WhatsApp, pedido explícito do usuário (19/09), inspirado
// na pré-visualização que a Meta já mostra na criação de modelos.

import type { QuickReplyAction } from "@/lib/quick-replies";

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm">
      {children}
    </div>
  );
}

/** Preview de uma mensagem de texto livre ou resposta rápida (não-template) —
 * uma bolha por ação (texto, imagem, vídeo, áudio; ações de funil não geram
 * bolha visível pro cliente). */
export function MessagePreview({
  actions,
  variantPreview,
}: {
  actions: QuickReplyAction[];
  // Primeira variação de texto (quando há mais de uma, mostra ela como
  // exemplo — as outras são sorteadas aleatoriamente por contato no envio
  // real, não dá pra prever qual cada um vai receber).
  variantPreview?: string;
}) {
  const hasContent = actions.some(
    (a) =>
      (a.type === "text" && (a.text?.trim() || variantPreview?.trim())) ||
      (a.type !== "text" && a.type !== "funnel_add" && a.type !== "funnel_remove" && a.path),
  );

  return (
    <div className="rounded-xl border border-neutral-200 bg-[#e5ded8] p-4">
      <p className="mb-2 text-xs font-medium text-neutral-500">Como vai chegar</p>
      {!hasContent ? (
        <p className="text-sm text-neutral-500">Defina a mensagem para ver a prévia.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((action, i) => {
            if (action.type === "funnel_add" || action.type === "funnel_remove") return null;
            if (action.type === "text") {
              const text = i === 0 && variantPreview?.trim() ? variantPreview : action.text;
              if (!text?.trim()) return null;
              return (
                <Bubble key={i}>
                  <p className="whitespace-pre-wrap">{text}</p>
                </Bubble>
              );
            }
            if (action.type === "image" && action.url) {
              return (
                <Bubble key={i}>
                  <img src={action.url} alt="" className="mb-1 max-h-40 rounded object-cover" />
                  {action.caption && <p className="whitespace-pre-wrap">{action.caption}</p>}
                </Bubble>
              );
            }
            if (action.type === "video" && action.url) {
              return (
                <Bubble key={i}>
                  <video src={action.url} className="mb-1 max-h-40 rounded" controls />
                  {action.caption && <p className="whitespace-pre-wrap">{action.caption}</p>}
                </Bubble>
              );
            }
            if (action.type === "audio" && action.url) {
              return (
                <Bubble key={i}>
                  <audio src={action.url} controls className="max-w-full" />
                </Bubble>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

/** Preview de um modelo aprovado (Meta) — corpo do template com as
 * variáveis substituídas por exemplo, mais cabeçalho de imagem/carrossel
 * quando existir. */
export function TemplatePreview({
  bodyText,
  headerImageUrl,
  carouselImageUrls,
}: {
  bodyText: string;
  headerImageUrl?: string | null;
  carouselImageUrls?: (string | null)[];
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-[#e5ded8] p-4">
      <p className="mb-2 text-xs font-medium text-neutral-500">Como vai chegar</p>
      <Bubble>
        {headerImageUrl && (
          <img src={headerImageUrl} alt="" className="mb-1 max-h-40 w-full rounded object-cover" />
        )}
        {carouselImageUrls && carouselImageUrls.length > 0 && (
          <div className="mb-1 flex gap-1 overflow-x-auto">
            {carouselImageUrls.map((url, i) =>
              url ? (
                <img
                  key={i}
                  src={url}
                  alt=""
                  className="h-20 w-20 flex-shrink-0 rounded object-cover"
                />
              ) : (
                <div
                  key={i}
                  className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded bg-neutral-200 text-xs text-neutral-400"
                >
                  Cartão {i + 1}
                </div>
              ),
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap">{bodyText || "Escolha um modelo para ver a prévia."}</p>
      </Bubble>
    </div>
  );
}
