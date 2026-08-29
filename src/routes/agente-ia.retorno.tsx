import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/agente-ia/retorno")({
  head: () => ({
    meta: [
      { title: "Compra confirmada | Agente de IA | CRM Zaylo" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: AgenteIaRetorno,
});

function AgenteIaRetorno() {
  const { session_id } = Route.useSearch();
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4">
      <div className="max-w-md space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">
          {session_id ? "Obrigado pela compra!" : "Sessão não encontrada"}
        </h1>
        <p className="text-sm text-neutral-400">
          {session_id
            ? "Um de nossos especialistas vai entrar em contato com você para iniciar as configurações da sua IA."
            : "Não recebemos os dados da sua compra. Se você já pagou, aguarde alguns instantes e recarregue o painel."}
        </p>
        <Button asChild className="w-full">
          <Link to="/painel">Voltar ao painel</Link>
        </Button>
      </div>
    </div>
  );
}
