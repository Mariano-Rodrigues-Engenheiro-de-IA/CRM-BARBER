// Preview de uma mensagem de texto livre ou resposta rápida (não-modelo
// aprovado). Usa o MESMO estilo visual do TemplatePreview real (ver
// whatsapp-template-preview.tsx, reaproveitado na Etapa 2 do wizard de
// disparo para modelos aprovados), pedido explícito do usuário: manter
// consistência visual, sem ter duas prévias diferentes para a mesma
// coisa. Como mensagem livre tem uma estrutura de dados bem diferente
// de um modelo (várias ações em sequência em vez de um único corpo +
// mídia + botões), esse é um componente próprio, mas com o mesmo fundo,
// moldura de card, tamanho e tipografia.

import { useRef, useState } from "react";
import type { QuickReplyAction } from "@/lib/quick-replies";

/** Bolha de mensagem enviada (verde, alinhada à direita, igual
 * TemplatePreview). Mídia (quando existir) fica FORA do padding, colada
 * nas bordas do card, sem margem residual. Corrigido (19/09, quarta
 * correção): a versão anterior tentava "compensar" o padding da bolha
 * com margem negativa na imagem, mas isso deixava uma borda visível na
 * lateral e embaixo (o padding inferior da bolha nunca era compensado).
 * Agora a mídia é um slot PRÓPRIO, antes do padding, nunca fica dentro
 * dele, então não sobra borda nenhuma. */
function Bubble({
  media,
  children,
  hasMedia,
}: {
  media?: React.ReactNode;
  children?: React.ReactNode;
  hasMedia?: boolean;
}) {
  return (
    <div className="flex justify-end">
      <div
        className={
          "overflow-hidden rounded-lg bg-[#d9fdd3] shadow-md max-w-[85%] " +
          (hasMedia ? "w-full" : "w-fit")
        }
      >
        {media}
        <div className="px-2.5 pb-1.5 pt-2">
          {children}
          <p className="mt-1 text-right text-[9.5px] text-neutral-500">
            {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Áudio estilo mensagem de voz do WhatsApp: barrinhas de forma de onda
 * (decorativas, nao sincronizadas ao progresso real, pedido do
 * usuario: "os gravezinhos do audio"), botao de play/pause real
 * controlando um elemento de audio nativo escondido. */
function VoiceBubble({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  const bars = [6, 12, 18, 10, 22, 14, 8, 20, 12, 16, 9, 24, 13, 7, 17, 11, 19, 8, 15, 10];

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause();
    else void el.play();
  }

  function formatDuration(s: number) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        type="button"
        onClick={toggle}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
            <rect x="6" y="5" width="4" height="14" />
            <rect x="14" y="5" width="4" height="14" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-4 w-4">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <div className="flex h-6 min-w-[130px] flex-1 items-center gap-[2px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[2.5px] flex-shrink-0 rounded-full bg-emerald-700/60"
            style={{ height: h }}
          />
        ))}
      </div>
      <span className="flex-shrink-0 text-[10px] text-neutral-600">
        {duration != null ? formatDuration(duration) : "--:--"}
      </span>
      <audio
        ref={audioRef}
        src={url}
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
      />
    </div>
  );
}

export function MessagePreview({
  actions,
  variantPreview,
}: {
  actions: QuickReplyAction[];
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
            <p className="px-1 text-[12px] text-white">Defina a mensagem para ver a prévia.</p>
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
                  <Bubble
                    key={i}
                    hasMedia
                    media={
                      <img
                        src={action.url}
                        alt=""
                        className="block max-h-[280px] w-full object-cover"
                      />
                    }
                  >
                    {action.caption && (
                      <p className="whitespace-pre-wrap text-[13px] leading-snug text-neutral-800">
                        {action.caption}
                      </p>
                    )}
                  </Bubble>
                );
              }
              if (action.type === "video" && action.url) {
                return (
                  <Bubble
                    key={i}
                    hasMedia
                    media={
                      <div className="relative">
                        <video
                          src={action.url}
                          className="block max-h-[280px] w-full bg-black object-cover"
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
                    }
                  >
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
                    <VoiceBubble url={action.url} />
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
