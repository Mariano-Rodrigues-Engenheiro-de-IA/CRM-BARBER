// Tela de bloqueio reutilizável pra recursos exclusivos do plano
// Premium (IA, Ranking, etc) - cadeado + botao de compra bem visivel,
// aparece assim que a pessoa entra na aba. Pedido do Mariano: nao só
// texto, tem que ficar claro que é um botão clicável.
export function PremiumLock({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const link = `${window.location.origin}/assinar?plano=premium_197`;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-neutral-300 bg-white p-10 text-center shadow-sm">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-neutral-500" fill="currentColor">
          <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3Zm0 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <p className="mt-2 text-sm text-neutral-500">{description}</p>
      <a
        href={link}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-brand-strong"
      >
        Comprar Premium
      </a>
    </div>
  );
}
