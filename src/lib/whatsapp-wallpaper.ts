// Padrão de fundo estilo "papel de parede" do WhatsApp — textura sutil
// com pequenos elementos decorativos repetidos, no tom bege/verde claro
// característico. Desenho PRÓPRIO (formas genéricas: folhas, círculos,
// ondas), não uma cópia dos ícones proprietários da Meta — captura a
// textura visual (repetição, densidade, tom de cor) sem reproduzir o
// design exato.
//
// Aplicado como background-image (SVG embutido via data URI) no lugar
// do fundo sólido bege usado antes, pedido explícito do usuário: deixar
// a prévia da mensagem visualmente mais fiel ao WhatsApp real.

const PATTERN_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <rect width="220" height="220" fill="#e5ddd5"/>
  <g fill="#d9d0c7" opacity="0.55">
    <path d="M30 20c8-6 18-4 20 4s-6 14-14 12-14-10-6-16z"/>
    <circle cx="110" cy="35" r="5"/>
    <path d="M150 15c6 4 6 12 0 16s-14 0-14-8 8-12 14-8z"/>
    <path d="M20 100q10-8 20 0t20 0" stroke="#d9d0c7" stroke-width="2" fill="none"/>
    <circle cx="90" cy="110" r="4"/>
    <path d="M140 95c7-5 16-3 18 4s-5 12-12 10-13-9-6-14z"/>
    <path d="M190 60q6-6 12 0t12 0" stroke="#d9d0c7" stroke-width="2" fill="none"/>
    <circle cx="30" cy="170" r="5"/>
    <path d="M75 165c7-5 16-3 18 4s-5 12-12 10-13-9-6-14z"/>
    <path d="M150 180q8-7 16 0t16 0" stroke="#d9d0c7" stroke-width="2" fill="none"/>
    <circle cx="200" cy="150" r="4"/>
  </g>
</svg>
`.trim();

export const WHATSAPP_WALLPAPER_STYLE: React.CSSProperties = {
  backgroundColor: "#e5ddd5",
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(PATTERN_SVG)}")`,
  backgroundRepeat: "repeat",
  backgroundSize: "220px 220px",
};
