import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const Route = createFileRoute("/assinar_/retorno")({
  head: () => ({
    meta: [
      { title: "Assinatura confirmada | CRM Zaylo" },
      { name: "description", content: "Sua assinatura Premium do CRM foi processada." },
      { property: "og:title", content: "Assinatura confirmada | CRM Zaylo" },
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

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="32"
      height="32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-xs font-bold text-blue-400">
      {n}
    </span>
  );
}

// Página de "obrigado" pós-compra: Stripe redireciona pra cá (return_url
// em assinar.tsx) depois do checkout embutido. Reformulada a pedido do
// Mariano - versão antiga só tinha um título curto e um botão, sem
// próximos passos nem visual à altura do resto do site.
function Retorno() {
  const { session_id } = Route.useSearch();

  if (!session_id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100">
        <Card className="w-full max-w-md border-neutral-800 bg-neutral-900/95 text-neutral-100">
          <CardHeader>
            <CardTitle>Sessão não encontrada</CardTitle>
            <CardDescription className="text-neutral-400">
              Não recebemos os dados da sua compra. Se você já pagou, aguarde alguns segundos e
              recarregue o painel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link to="/painel">Voltar ao painel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100">
      <Card className="w-full max-w-lg border-blue-500/30 bg-neutral-900/95 text-neutral-100 shadow-[0_0_50px_-15px_rgba(59,130,246,0.4)]">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <CheckIcon />
          </div>
          <CardTitle className="text-2xl">Assinatura confirmada 🎉</CardTitle>
          <CardDescription className="text-neutral-400">
            Sua assinatura Premium do CRM Zaylo foi ativada, todos os limites do plano grátis já
            foram liberados.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-950/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Próximos passos
            </p>
            <ol className="space-y-3 text-sm text-neutral-300">
              <li className="flex items-start gap-3">
                <StepNumber n={1} />
                <span>
                  Se ainda não instalou, adicione a extensão do CRM ao Chrome pra usar dentro do
                  WhatsApp Web.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <StepNumber n={2} />
                <span>Conecte seu WhatsApp na aba de Conexão dentro do painel.</span>
              </li>
              <li className="flex items-start gap-3">
                <StepNumber n={3} />
                <span>
                  Explore o Kanban de leads, configure o Agente de IA e crie sua primeira campanha,
                  tudo já sem limite.
                </span>
              </li>
            </ol>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link to="/painel">Ir para o painel</Link>
            </Button>
            <Button asChild variant="outline" className="flex-1 border-neutral-700 text-neutral-300 hover:text-neutral-50">
              <Link to="/instalar">Instalar a extensão</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
