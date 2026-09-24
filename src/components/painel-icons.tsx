// Ícones SVG reutilizados no painel principal, extraídos de painel.tsx
// pra reduzir o tamanho desse arquivo (era um dos 3 arquivos gigantes
// apontados na varredura de código morto/arquitetura).

/** Selo de assinante ativo — assinatura/fidelidade, sem usar ícone de pessoas. */
export function IconBadgeCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.3 11 14.8l4.5-5" />
    </svg>
  );
}

/** Barras ascendentes — ranking de vendas (não amarrado a "barbeiro"/troféu). */
export function IconRankingBars() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="13" width="4.5" height="7" rx="1" />
      <rect x="9.75" y="9" width="4.5" height="11" rx="1" />
      <rect x="16" y="4.5" width="4.5" height="15.5" rx="1" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconTrophy() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 5h3v3a3 3 0 0 1-3 3" />
      <path d="M7 5H4v3a3 3 0 0 0 3 3" />
    </svg>
  );
}

export function IconGear({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

/** Raio — Respostas rápidas. Mesmo ícone usado no rail do WhatsApp e dentro
 * de cada conversa, pra ficar padronizado em todo o sistema. */
export function IconChart() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  );
}

export function IconChevron({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={"transition " + className}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Cabeçalho padrão das telas — ícone num quadrado colorido + título com peso
 * de verdade (não mais caps-lock) + linha de apoio opcional. Piloto em
 * Agenda / Assinaturas / Ranking de vendas antes de estender pro resto. */
/** Ícone de cadeado — usado só dentro do modal de upgrade, no selo colorido do topo. */
export function IconLock() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Aviãozinho de disparo — o clássico ícone de "enviar em massa". */
export function IconSend() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

export function IconMegaphone() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 11 18-5v12L3 13v-2Z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

export function IconCalendar() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

/** Plug — seção de Conexão (não repetir o ícone de Assinaturas). */
/** Link/corrente — plugue trocado por um símbolo mais "conexão/integração". */
export function IconPlug() {
  // Ícone de celular — o de "plugue" antigo não dava a entender que é a
  // conexão com o WhatsApp. Não uso o logo oficial do WhatsApp aqui (é
  // uma marca registrada da Meta), só um celular genérico mesmo.
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.2" />
      <path d="M10.5 18.2h3" />
    </svg>
  );
}

export function IconGraduationCap() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 9 12 3 1 9l11 6 11-6Z" />
      <path d="M5 11.5v5c0 1.8 3.1 3.5 7 3.5s7-1.7 7-3.5v-5" />
      <path d="M23 9v7" />
    </svg>
  );
}

export function IconRobot() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="8.5" width="18" height="12.5" rx="2.5" />
      <path d="M12 8.5V4" />
      <circle cx="12" cy="2.5" r="1.6" />
      <circle cx="8.5" cy="14.5" r="1.2" />
      <circle cx="15.5" cy="14.5" r="1.2" />
      <path d="M1 12.5v4M23 12.5v4" />
    </svg>
  );
}

export function IconWhatsapp() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M12 2C6.5 2 2 6.4 2 11.8c0 1.9.5 3.7 1.5 5.3L2 22l5.1-1.4c1.5.8 3.2 1.3 4.9 1.3 5.5 0 10-4.4 10-9.9C22 6.4 17.5 2 12 2Zm5.6 14c-.2.7-1.4 1.3-2 1.4-.5.1-1.2.1-1.9-.1-.4-.1-1-.3-1.7-.6-3-1.3-4.9-4.3-5.1-4.5-.1-.2-1.2-1.6-1.2-3.1s.8-2.2 1.1-2.5c.3-.3.6-.4.8-.4h.6c.2 0 .5 0 .7.6l1 2.3c.1.2.1.4 0 .6l-.5.6-.4.5c-.1.2-.3.4-.1.7.2.3.9 1.4 1.9 2.3 1.3 1.2 2.4 1.5 2.7 1.7.3.2.5.1.7-.1l.9-1c.2-.3.4-.2.7-.1l2.1 1c.3.1.6.2.6.4.1.2.1.9-.1 1.6Z" />
    </svg>
  );
}

/** Layout de template — retângulo com cabeçalho + linhas de conteúdo. */
export function IconNote() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4.5" y="3.5" width="15" height="17" rx="1.6" />
      <path d="M4.5 8.5h15" />
      <path d="M8 12.3h8M8 15.5h5.5" />
    </svg>
  );
}

export function IconClock() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="13" r="8" />
      <path d="M11 9.2V13l2.6 1.6" />
      <path d="M8.2 2.6h5.6M18.5 5l1.6-1.6" />
    </svg>
  );
}

export function IconScissors() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}

export function IconProfile() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3.5" width="18" height="17" rx="3.2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 17.2c.9-2.3 3-3.7 5.5-3.7s4.6 1.4 5.5 3.7" />
    </svg>
  );
}

export function IconDeal() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="6" width="20" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9v.01M18 15v.01" />
    </svg>
  );
}

export function IconTrashMini() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

export function IconPencilMini() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** Ícone de etiqueta (formato de bandeirinha inclinada), colorido com a cor
 * real da etiqueta do WhatsApp. Mostra o nome só no hover (title), sem
 * poluir o card com texto fixo. */
export function IconTag({ color, title }: { color: string | null; title: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-xl border border-neutral-300 bg-white"
    >
      {color ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill={color}>
          <path d="M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l9 9a2 2 0 0 1 0 2.82Z" />
          <circle cx="6.5" cy="6.5" r="1.5" fill="white" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d4d4d4"
          strokeWidth="1.5"
        >
          <path d="M20.59 13.41 12 22l-9-9V4a1 1 0 0 1 1-1h9l9 9a2 2 0 0 1 0 2.82Z" />
          <circle cx="6.5" cy="6.5" r="1.5" />
        </svg>
      )}
    </span>
  );
}
