import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/assinar/retorno")({
  head: () => ({
    meta: [
      { title: "Assinatura confirmada — CRM Zaylo" },
      { name: "description", content: "Sua assinatura Premium do CRM foi processada." },
      { property: "og:title", content: "Assinatura confirmada — CRM Zaylo" },
      { property: "og:description", content: "Sua assinatura Premium do CRM foi processada." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: Retorno,
});

function Retorno() {
  const { session_id } = Route.useSearch();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {session_id ? "Pagamento concluído!" : "Sessão não encontrada"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {session_id
            ? "Sua assinatura Premium foi ativada. Volte ao painel — os limites do plano grátis já foram liberados."
            : "Não recebemos os dados da sua compra. Se você já pagou, aguarde alguns segundos e recarregue o painel."}
        </p>
        <Button asChild>
          <Link to="/painel">Voltar ao painel</Link>
        </Button>
      </div>
    </div>
  );
}
