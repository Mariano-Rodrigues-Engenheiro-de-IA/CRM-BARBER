import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Placeholder URL — troque quando a extensão estiver publicada na Chrome Web Store.
const CHROME_STORE_URL = "https://chromewebstore.google.com/";

export const Route = createFileRoute("/instalar")({
  head: () => ({
    meta: [
      { title: "Instalar extensão — CRM de Assinaturas" },
      {
        name: "description",
        content:
          "Adicione a extensão ao seu Chrome e abra o WhatsApp Web para começar a usar o CRM.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Install,
});

function Install() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Cadastro concluído</CardTitle>
          <CardDescription>
            Agora instale a extensão no seu Chrome. Ela vai reconhecer seu WhatsApp
            automaticamente quando você abrir o WhatsApp Web.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild size="lg" className="w-full">
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer">
              Adicionar ao Chrome
            </a>
          </Button>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Clique em <strong>Adicionar ao Chrome</strong>.</li>
            <li>Confirme a instalação na janela do Chrome.</li>
            <li>Abra o <strong>WhatsApp Web</strong> — o CRM aparece dentro dele.</li>
          </ol>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">Voltar para a página inicial</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
