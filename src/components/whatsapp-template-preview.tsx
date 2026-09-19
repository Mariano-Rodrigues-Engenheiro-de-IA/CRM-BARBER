// Prévia visual de um modelo aprovado (Meta), estilo bolha de chat do
// WhatsApp, com fundo "papel de parede" nativo. Extraído de
// templates-view.tsx (19/09) para ser reaproveitado também na Etapa 2 do
// wizard de disparo — pedido explícito do usuário: usar EXATAMENTE o
// mesmo componente visual em ambos os lugares, não duas prévias
// diferentes para a mesma coisa.

export function TemplatePreview({
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
  carouselCards: Array<{
    file: { dataUrl: string; mime: string; filename: string } | null;
    bodyText: string;
  }>;
  carouselButtons: Array<{ type: string; text: string; url?: string }>;
}) {
  function renderBody(text: string) {
    const filled = text.replace(
      /\{\{([a-z0-9_]+)\}\}/g,
      (_, v) => bodyExamples[v]?.trim() || `[${v}]`,
    );
    return filled || "Sua mensagem aparece aqui…";
  }

  function ButtonIcon({ type }: { type: string }) {
    if (type === "URL")
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M10 14 21 3M15 3h6v6M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      );
    if (type === "PHONE_NUMBER")
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 3a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c1 .3 2 .5 3 .7a2 2 0 0 1 1.6 2Z" />
        </svg>
      );
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
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
        <div className="flex h-40 w-full items-center justify-center rounded-t-lg bg-neutral-200 text-neutral-400">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
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
        <div className="flex h-40 w-full items-center justify-center rounded-t-lg bg-neutral-200 text-neutral-400">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m10 8 6 4-6 4V8Z" />
            <rect x="2" y="4" width="20" height="16" rx="2" />
          </svg>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-t-lg bg-neutral-100 px-3 py-3 text-neutral-500">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="shrink-0"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="truncate text-xs">{file ? file.filename : "documento.pdf"}</span>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-neutral-900">Prévia do modelo</p>

      {/* Fundo do WhatsApp por trás do card — sem moldura de celular (isso
         ficou artificial), só o "papel de parede" do chat mesmo, igual a
         própria Meta mostra na tela de criação de modelo dela. Card usa
         w-full (em vez de largura fixa) pra sempre caber certinho dentro
         do espaçamento, sem ficar desalinhado. */}
      <div className="rounded-xl bg-[#e5ddd5] p-5">
        <div className="relative mx-auto w-full max-w-[240px]">
          <div className="overflow-hidden rounded-lg bg-white shadow-md">
            {(templateType === "image" ||
              templateType === "video" ||
              templateType === "document") && <MediaBox file={mediaFile} kind={templateType} />}
            <div className="px-2.5 pb-1.5 pt-2">
              <p className="whitespace-pre-wrap text-[12px] leading-snug text-neutral-800">
                {renderBody(bodyText)}
              </p>
              {footerText && <p className="mt-1 text-[10.5px] text-neutral-400">{footerText}</p>}
              <p className="mt-1 text-right text-[9.5px] text-neutral-400">
                {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            {templateType !== "carousel" && buttons.length > 0 && (
              <div className="border-t border-neutral-100">
                {buttons.map((b, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-center gap-1.5 border-t border-neutral-100 py-1.5 text-[12px] text-blue-600 first:border-t-0"
                  >
                    <ButtonIcon type={b.type} />
                    {b.text || "Botão"}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {templateType === "carousel" && (
          <div className="mx-auto mt-2 flex w-full max-w-[240px] gap-2 overflow-x-auto pb-1">
            {carouselCards.map((card, i) => (
              <div key={i} className="w-28 shrink-0 overflow-hidden rounded-lg bg-white shadow-sm">
                <MediaBox file={card.file} kind="image" />
                {card.bodyText && (
                  <p className="px-2 py-1.5 text-[10px] text-neutral-800">{card.bodyText}</p>
                )}
                {carouselButtons.length > 0 && (
                  <div className="border-t border-neutral-100">
                    {carouselButtons.map((b, bi) => (
                      <div
                        key={bi}
                        className="flex items-center justify-center gap-1 border-t border-neutral-100 py-1.5 text-[10px] text-blue-600 first:border-t-0"
                      >
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
