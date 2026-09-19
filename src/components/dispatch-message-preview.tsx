// Preview de uma mensagem de texto livre ou resposta rápida (não-modelo
// aprovado). Usa o MESMO estilo visual do TemplatePreview real (ver
// whatsapp-template-preview.tsx, reaproveitado na Etapa 2 do wizard de
// disparo para modelos aprovados), pedido explícito do usuário: manter
// consistência visual, sem ter duas prévias diferentes para a mesma
// coisa. Como mensagem livre tem uma estrutura de dados bem diferente
// de um modelo (várias ações em sequência em vez de um único corpo +
// mídia + botões), esse é um componente próprio, mas com o mesmo fundo,
// moldura de card, tamanho e tipografia.

import type { QuickReplyAction } from "@/lib/quick-replies";

// ⚠️ Corrigido (19/09, terceira correção): antes cada bolha SEMPRE
// esticava até a largura máxima do container, mesmo mensagens de 1
// palavra (bug real: "mensagem curta ficando artificialmente larga").
// Agora bolhas de texto/áudio encolhem pro conteúdo (w-fit) até um teto
// de 85% da largura da "tela simulada"; bolhas com mídia (imagem/vídeo)
// esticam até esse mesmo teto, já que a mídia justifica a largura.
function Bubble({ children, hasMedia }: { children: React.ReactNode; hasMedia?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={
          "overflow-hidden rounded-lg bg-[#d9fdd3] px-2.5 pb-1.5 pt-2 shadow-md max-w-[85%] " +
          (hasMedia ? "w-full" : "w-fit")
        }
      >
        {children}
        <p className="mt-1 text-right text-[9.5px] text-neutral-500">
          {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

export function MessagePreview({
  actions,
  variantPreview,
}: {
  actions: QuickReplyAction[];
  // Primeira variação de texto (quando há mais de uma, mostra ela como
  // exemplo, as outras são sorteadas aleatoriamente por contato no envio
  // real, não dá pra prever qual cada um vai receber).
  variantPreview?: string;
}) {
  const hasContent = actions.some(
    (a) =>
      (a.type === "text" && (a.text?.trim() || variantPreview?.trim())) ||
      (a.type !== "text" && a.type !== "funnel_add" && a.type !== "funnel_remove" && a.path),
  );

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-neutral-900">Prévia da mensagem</p>
      <div className="rounded-xl bg-[#e5ddd5] p-5">
        <div className="mx-auto w-full max-w-[340px] space-y-2">
          {!hasContent ? (
            <p className="px-1 text-[12px] text-neutral-500">
              Defina a mensagem para ver a prévia.
            </p>
          ) : (
            actions.map((action, i) => {
              if (action.type === "funnel_add" || action.type === "funnel_remove") return null;
              if (action.type === "text") {
                const text = i === 0 && variantPreview?.trim() ? variantPreview : action.text;
                if (!text?.trim()) return null;
                return (
                  <Bubble key={i}>
                    <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
                      {text}
                    </p>
                  </Bubble>
                );
              }
              if (action.type === "image" && action.url) {
                return (
                  <Bubble key={i} hasMedia>
                    <img
                      src={action.url}
                      alt=""
                      className="-mx-2.5 -mt-2 mb-1 block max-h-[280px] w-[calc(100%+20px)] object-cover"
                    />
                    {action.caption && (
                      <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
                        {action.caption}
                      </p>
                    )}
                  </Bubble>
                );
              }
              if (action.type === "video" && action.url) {
                // Player nativo com "controls" pode falhar silenciosamente
                // em alguns formatos/navegadores (caso real reportado:
                // "coloquei o vídeo, não apareceu"). O WhatsApp de
                // verdade também não toca o vídeo direto na bolha —
                // mostra uma miniatura com botão de play, só reproduz ao
                // tocar. Replicando esse comportamento: mais fiel E mais
                // confiável (o <video> só mostra o primeiro frame como
                // pôster, não precisa decodificar/tocar o arquivo).
                return (
                  <Bubble key={i} hasMedia>
                    <div className="relative -mx-2.5 -mt-2 mb-1">
                      <video
                        src={action.url}
                        className="block max-h-[280px] w-[calc(100%+20px)] bg-black object-cover"
                        preload="metadata"
                        muted
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45">
                          <svg viewBox="0 0 24 24" fill="white" className="ml-0.5 h-6 w-6">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                    </div>
                    {action.caption && (
                      <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
                        {action.caption}
                      </p>
                    )}
                  </Bubble>
                );
              }
              if (action.type === "audio" && action.url) {
                return (
                  <Bubble key={i}>
                    <div className="flex min-w-[220px] items-center gap-2">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-4 w-4">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                      <audio src={action.url} controls className="h-9 w-full min-w-0" />
                    </div>
                  </Bubble>
                );
              }
              return null;
            })
          )}
        </div>
      </div>
    </div>
  );
}
