import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHROME_STORE_URL, hasChromeStore } from "@/lib/site-config";

export const Route = createFileRoute("/instalar")({
  head: () => ({
    meta: [
      { title: "Adicionar ao Chrome | CRM Zaylo" },
      {
        name: "description",
        content:
          "Adicione a extensão ao Chrome e comece a usar o CRM de assinaturas dentro do WhatsApp Web.",
      },
      { property: "og:title", content: "Adicionar ao Chrome | CRM Zaylo" },
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
// Nome de arquivo ESTÁVEL — mesmo motivo do /baixar: sem número de
// versão no nome, pra nunca mais ficar servindo pacote antigo sem
// ninguém perceber.
function downloadZip() {
  const url = `/zaylo-crm-latest.zip?t=${Date.now()}`;
  fetch(url, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`Falha ao baixar: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "zaylo-crm-latest.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err) => toast.error(err.message));
}

function Install() {
  const naStore = hasChromeStore();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-neutral-950 px-4 py-10 text-neutral-100">
      <div
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(59,130,246,0.18), transparent 55%), radial-gradient(circle at 80% 80%, rgba(6,182,212,0.14), transparent 55%)",
        }}
      />
      <Card className="relative z-10 w-full max-w-lg border-blue-500/30 bg-neutral-900/95 text-neutral-100 shadow-[0_0_50px_-15px_rgba(59,130,246,0.4)] backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Cadastro concluído</CardTitle>
          <CardDescription className="text-neutral-400">
            {naStore
              ? "Agora é só adicionar a extensão ao Chrome e abrir o WhatsApp Web. Pronto, nada mais pra configurar."
              : "A extensão está em publicação na Chrome Web Store. Enquanto isso, instale como extensão descompactada (30 segundos)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {naStore ? (
            <>
              <Button
                asChild
                size="lg"
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 font-black uppercase tracking-wide text-white shadow-[0_0_25px_-5px_rgba(59,130,246,0.6)] transition hover:scale-[1.02] hover:brightness-110"
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
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 font-black uppercase tracking-wide text-white shadow-[0_0_25px_-5px_rgba(59,130,246,0.6)] transition hover:scale-[1.02] hover:brightness-110"
                onClick={downloadZip}
              >
                Baixar extensão (.zip)
              </Button>
              <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                Importante: remova a versão anterior em{" "}
                <code className="rounded bg-neutral-800 px-1">chrome://extensions</code> antes de instalar.
              </p>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-neutral-400">
                <li>Descompacte o arquivo baixado em uma pasta.</li>
                <li>
                  Abra <code className="rounded bg-neutral-800 px-1">chrome://extensions</code> no Chrome.
                </li>
                <li>Ative o <strong>Modo do desenvolvedor</strong> (canto superior direito).</li>
                <li>Clique em <strong>Carregar sem compactação</strong> e selecione a pasta.</li>
                <li>Abra o <strong>WhatsApp Web</strong>. O CRM aparece na lateral esquerda.</li>
              </ol>
            </>
          )}
          <p className="text-xs text-neutral-500">
            O plano grátis já vem liberado. Quando bater o limite, o painel mostra o botão de assinar
            o Premium por R$ 197/mês.
          </p>
          <Button asChild variant="ghost" className="w-full text-neutral-300 hover:text-neutral-50">
            <Link to="/">Voltar para a página inicial</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
