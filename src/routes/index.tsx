import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CRM de Assinaturas para Barbearias" },
      {
        name: "description",
        content:
          "Organize seus clientes assinantes, crie campanhas de cobrança e fidelização e dispare mensagens diretamente pelo WhatsApp Web.",
      },
      { property: "og:title", content: "CRM de Assinaturas para Barbearias" },
      {
        property: "og:description",
        content:
          "Gestão de assinaturas + disparo pelo WhatsApp Web via extensão, sem servidor de disparo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app", replace: true });
      else setChecked(true);
    });
  }, [navigate]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <div className="max-w-2xl space-y-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          CRM de assinaturas para barbearias
        </h1>
        <p className="text-lg text-muted-foreground">
          Organize seus clientes assinantes, crie campanhas de cobrança, reativação e
          fidelização, e dispare mensagens direto no seu WhatsApp Web — sem servidor de
          disparo, sem instância paga rodando 24h.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Entrar</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Criar conta</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
