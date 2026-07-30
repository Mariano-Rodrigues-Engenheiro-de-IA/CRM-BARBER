import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHROME_STORE_URL, hasChromeStore } from "@/lib/site-config";

export const Route = createFileRoute("/instalar")({
  head: () => ({
    meta: [
      { title: "Adicionar ao Chrome — CRM de Assinaturas" },
      {
        name: "description",
        content:
          "Adicione a extensão ao Chrome e comece a usar o CRM de assinaturas dentro do WhatsApp Web.",
      },
      { property: "og:title", content: "Adicionar ao Chrome — CRM de Assinaturas" },
      {
        property: "og:description",
        content:
          "Adicione a extensão ao Chrome e comece a usar o CRM de assinaturas dentro do WhatsApp Web.",
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
  const version = Date.now();
  const urls = [
    `/crm-assinaturas-extension-v2200.zip?v=${version}`,
    `/crm-assinaturas-extension.zip?v=${version}`,
  ];
  urls
    .reduce<Promise<Response>>(
      (prev, url) =>
        prev.catch(() =>
          fetch(url, { cache: "no-store" }).then((res) => {
            if (!res.ok) throw new Error(`Falha ao baixar: ${res.status}`);
            return res;
          }),
        ),
      Promise.reject(new Error("Iniciando download")),
    )
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "crm-assinaturas-extension-v2200.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => toast.error(err.message));
}

function Install() {
  const naStore = hasChromeStore();

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100">
      <Card className="w-full max-w-lg border-yellow-400/30 bg-neutral-900 text-neutral-100">
        <CardHeader>
          <CardTitle>Cadastro concluído</CardTitle>
          <CardDescription className="text-neutral-400">
            {naStore
              ? "Agora é só adicionar a extensão ao Chrome e abrir o WhatsApp Web. Pronto — nada mais pra configurar."
              : "A extensão está em publicação na Chrome Web Store. Enquanto isso, instale como extensão descompactada (30 segundos)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {naStore ? (
            <>
              <Button
                asChild
                size="lg"
                className="w-full bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
              >
                <a href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
                  ADICIONAR AO CHROME
                </a>
              </Button>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-400">
                <li>Clique em <strong>Adicionar ao Chrome</strong> na loja e confirme.</li>
                <li>Abra o <strong>WhatsApp Web</strong> com o número da barbearia.</li>
                <li>O CRM aparece na lateral e faz o pareamento sozinho.</li>
              </ol>
            </>
          ) : (
            <>
              <Button
                size="lg"
                className="w-full bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
                onClick={downloadZip}
              >
                Baixar extensão v0.22.0 (.zip)
              </Button>
              <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                Importante: remova a versão anterior em{" "}
                <code className="rounded bg-neutral-800 px-1">chrome://extensions</code> antes de instalar.
                A versão precisa aparecer como <strong>0.22.0</strong>.
              </p>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-400">
                <li>Descompacte o arquivo baixado em uma pasta.</li>
                <li>
                  Abra <code className="rounded bg-neutral-800 px-1">chrome://extensions</code> no Chrome.
                </li>
                <li>Ative o <strong>Modo do desenvolvedor</strong> (canto superior direito).</li>
                <li>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta.</li>
                <li>Abra o <strong>WhatsApp Web</strong> — o CRM aparece na lateral esquerda.</li>
              </ol>
            </>
          )}
          <p className="text-xs text-neutral-500">
            O plano grátis já vem liberado. Quando bater o limite, o painel mostra o botão de assinar
            o Premium por R$ 97/mês.
          </p>
          <Button asChild variant="ghost" className="w-full text-neutral-300 hover:text-neutral-50">
            <Link to="/">Voltar para a página inicial</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
