import { useEffect, useState } from "react";
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
  const [isMobile, setIsMobile] = useState(false);
  const [link, setLink] = useState("https://crm.zayloia.com/instalar");

  useEffect(() => {
    const ua = navigator.userAgent;
    // iPad novo se apresenta como Mac, mas tem toque.
    const ipadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua) || ipadAsMac;
    // Celular com "Site para computador" ligado se apresenta como PC e escapa
    // do user agent. Pega pelo aparelho: toque como entrada principal + tela
    // pequena (notebook, mesmo com tela de toque, tem tela maior).
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const smallScreen = Math.min(window.screen.width, window.screen.height) < 900;
    setIsMobile(uaMobile || (coarse && smallScreen));
    setLink(`${window.location.origin}/instalar`);
  }, []);

  function sendToWhatsApp() {
    const text = `Abra este link no computador para instalar a extensão do CRM Zaylo no Google Chrome: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado. Cole no navegador do computador.");
    } catch {
      toast.error("Não consegui copiar. Segure o link e copie manualmente.");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-10 text-neutral-100">
      <Card className="w-full max-w-lg border-blue-500/30 bg-neutral-900/95 text-neutral-100 shadow-[0_0_50px_-15px_rgba(59,130,246,0.4)]">
        <CardHeader>
          <CardTitle>Cadastro concluído</CardTitle>
          <CardDescription className="text-neutral-400">
            {isMobile
              ? "Seu cadastro foi feito. Falta só instalar a extensão, e isso é feito no computador."
              : naStore
              ? "Agora é só adicionar a extensão ao Chrome e abrir o WhatsApp Web. Pronto, nada mais pra configurar."
              : "A extensão está em publicação na Chrome Web Store. Enquanto isso, instale como extensão descompactada (30 segundos)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isMobile ? (
            <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <p className="text-sm font-bold text-amber-300">Você está no celular</p>
              <p className="text-sm text-amber-100/90">
                A extensão só funciona no <strong>Google Chrome do computador</strong>. Abra este link no
                computador para instalar.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  onClick={sendToWhatsApp}
                  className="flex-1 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
                >
                  Enviar o link pro meu WhatsApp
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyLink}
                  className="flex-1 border-neutral-600 bg-transparent text-neutral-100 hover:bg-neutral-800"
                >
                  Copiar link
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">A extensão funciona no Google Chrome, no computador.</p>
          )}
          {isMobile ? null : naStore ? (
            <>
              <Button
                asChild
                className="mx-auto block w-fit bg-gradient-to-r from-blue-600 to-cyan-500 px-6 font-bold text-white shadow-[0_0_20px_-5px_rgba(59,130,246,0.6)] transition hover:scale-[1.02] hover:brightness-110"
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
                className="mx-auto block w-fit bg-gradient-to-r from-blue-600 to-cyan-500 px-6 font-bold text-white shadow-[0_0_20px_-5px_rgba(59,130,246,0.6)] transition hover:scale-[1.02] hover:brightness-110"
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
