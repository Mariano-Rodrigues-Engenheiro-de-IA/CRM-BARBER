import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

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
          "Extensão de Chrome que transforma seu WhatsApp Web em um CRM completo pra gerenciar clientes assinantes, campanhas e disparos — sem trocar de ferramenta.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: z.string().trim().min(8, "Telefone inválido").max(20),
});

function Landing() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [loading, setLoading] = useState(false);

  function scrollToForm() {
    document.getElementById("cadastro")?.scrollIntoView({ behavior: "smooth" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = formSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/public/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        toast.error(json.error ?? "Falha ao cadastrar");
        return;
      }
      navigate({ to: "/instalar" });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="flex flex-col items-center px-6 pt-20 pb-16 text-center">
        <div className="max-w-3xl space-y-6">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            O CRM que vive dentro do seu WhatsApp Web
          </h1>
          <p className="text-lg text-muted-foreground">
            Instale a extensão, abra o WhatsApp Web e pronto — cadastre clientes
            assinantes, crie campanhas de cobrança e reativação, e dispare mensagens
            direto da sua própria sessão ou por API oficial nos clientes selecionados.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button size="lg" onClick={scrollToForm}>
              Testar agora
            </Button>
          </div>
        </div>
      </section>

      {/* Signup form */}
      <section id="cadastro" className="px-4 pb-24">
        <Card className="mx-auto w-full max-w-md">
          <CardHeader>
            <CardTitle>Comece o teste grátis</CardTitle>
            <CardDescription>
              Preencha seus dados para liberar a instalação da extensão.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                  maxLength={120}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  autoComplete="email"
                  maxLength={255}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">WhatsApp (com DDD)</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="ex: 11 99999-0000"
                  autoComplete="tel"
                  maxLength={20}
                  required
                />
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Enviando…" : "Instalar extensão"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
