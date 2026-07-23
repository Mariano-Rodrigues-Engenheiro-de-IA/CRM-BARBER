import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/instalar")({
  head: () => ({
    meta: [
      { title: "Instalar extensão — CRM de Assinaturas" },
      {
        name: "description",
        content:
          "Baixe a extensão e carregue no seu Chrome para começar a usar o CRM dentro do WhatsApp Web.",
      },
      { property: "og:title", content: "Instalar extensão — CRM de Assinaturas" },
      {
        property: "og:description",
        content:
          "Baixe a extensão e carregue no seu Chrome para começar a usar o CRM dentro do WhatsApp Web.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Install,
});

// Fetch+blob evita a auth do preview em links diretos pra /public.
function downloadZip() {
  fetch(`/crm-assinaturas-extension-v15.zip?v=${Date.now()}`, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`Falha ao baixar: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "crm-assinaturas-extension-v15.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => alert(err.message));
}

function Install() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Cadastro concluído</CardTitle>
          <CardDescription>
            Enquanto a extensão não está publicada na Chrome Web Store, instale
            como <strong>extensão descompactada</strong> (leva 30 segundos).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button size="lg" className="w-full" onClick={downloadZip}>
            Baixar extensão v0.15.2 (.zip)
          </Button>
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            Importante: remova a versão anterior em <code className="rounded bg-muted px-1">chrome://extensions</code> antes de instalar. A versão precisa aparecer como <strong>0.15.2</strong>.
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            <li>Descompacte o arquivo baixado em uma pasta.</li>
            <li>
              Abra <code className="rounded bg-muted px-1">chrome://extensions</code> no Chrome.
            </li>
            <li>
              Ative o <strong>Modo do desenvolvedor</strong> (canto superior direito).
            </li>
            <li>
              Clique em <strong>Carregar sem compactação</strong> e selecione a pasta.
            </li>
            <li>
              Abra o <strong>WhatsApp Web</strong> — o CRM aparece integrado na lateral esquerda.
            </li>
            <li>
              Se o WhatsApp já estava aberto, atualize a aba uma vez depois de instalar.
            </li>
          </ol>
          <p className="text-xs text-muted-foreground">
            Quando publicarmos na Chrome Web Store, esta página vai virar um
            botão único de <em>Adicionar ao Chrome</em>.
          </p>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/">Voltar para a página inicial</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
