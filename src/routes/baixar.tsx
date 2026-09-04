import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/baixar")({
  head: () => ({
    meta: [
      { title: "Baixar pacote da extensão | CRM Zaylo" },
      {
        name: "description",
        content:
          "Download direto do pacote .zip mais recente da extensão Zaylo CRM, pronto para upload no Chrome Web Store Developer Dashboard.",
      },
      { property: "og:title", content: "Baixar pacote da extensão" },
      {
        property: "og:description",
        content:
          "Pacote .zip mais recente da extensão Zaylo CRM pronto para upload na Chrome Web Store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BaixarPage,
});

// Nome de arquivo ESTÁVEL de propósito — sem número de versão no nome.
// Antes disso, a versão vinha fixa em código (VERSION/FILE hardcoded) e
// cada atualização da extensão exigia lembrar de editar essa página
// junto; esquecer isso foi exatamente o motivo de ficar meses servindo
// o pacote antigo sem ninguém perceber. Agora só troca o CONTEÚDO do
// arquivo (mesmo nome, sempre), essa página nunca mais precisa mudar.
const FILE = "/zaylo-crm-latest.zip";

function BaixarPage() {
  const [status, setStatus] = useState<string | null>(null);

  const download = () => {
    setStatus("Preparando download...");
    fetch(`${FILE}?t=${Date.now()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Falha no download: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "zaylo-crm-latest.zip";
        a.click();
        URL.revokeObjectURL(a.href);
        setStatus("Download iniciado. Confira a versão dentro de manifest.json depois de descompactar, pra ter certeza que é a mais nova.");
      })
      .catch((err: Error) => setStatus(err.message));
  };

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Pacote da extensão
          </p>
          <h1 className="text-3xl font-medium">
            Zaylo CRM (versão mais recente)
          </h1>
          <p className="text-sm text-muted-foreground">
            Arquivo .zip pronto para envio no Chrome Web Store Developer
            Dashboard (Package → Upload new package) ou para carregar como
            extensão descompactada.
          </p>
        </div>

        <button
          type="button"
          onClick={download}
          className="w-full rounded-md bg-primary px-6 py-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Baixar zaylo-crm-latest.zip
        </button>

        {status && (
          <p className="text-sm text-muted-foreground">{status}</p>
        )}

        <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
          <li>Baixe o .zip acima (não descompacte para enviar à loja).</li>
          <li>
            Abra o Developer Dashboard e selecione o item já publicado da
            extensão.
          </li>
          <li>Package → Upload new package → selecione o .zip.</li>
          <li>Salve o rascunho e envie para revisão.</li>
        </ol>
      </div>
    </main>
  );
}
