import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CRM de Assinaturas para Barbearias" },
      {
        name: "description",
        content:
          "Extensão de Chrome que transforma seu WhatsApp Web em um CRM completo pra gerenciar clientes assinantes, campanhas e disparos — sem trocar de ferramenta.",
      },
      { property: "og:title", content: "CRM de Assinaturas para Barbearias" },
      {
        property: "og:description",
        content:
          "Extensão de Chrome que transforma seu WhatsApp Web em um CRM completo pra gerenciar clientes assinantes e campanhas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          O CRM que vive dentro do seu WhatsApp Web
        </h1>
        <p className="text-lg text-muted-foreground">
          Instale a extensão, abra o WhatsApp Web e pronto — cadastre clientes assinantes,
          crie campanhas de cobrança e reativação, e dispare mensagens direto da sua
          própria sessão. Sem trocar de aba, sem servidor rodando 24h.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/ativar">Já tenho um código de ativação</Link>
          </Button>
        </div>
        <p className="pt-8 text-xs text-muted-foreground">
          Página de vendas e checkout entram aqui em breve.
        </p>
      </div>
    </div>
  );
}
