import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PREMIUM_PRICE_LABEL, PROMO_PRICE_LABEL, FREE_LIMITS } from "@/lib/billing";
import zettaLogo from "@/assets/zetta-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CRM completo para barbearias dentro do WhatsApp" },
      {
        name: "description",
        content:
          "Assinaturas, vendas, funis, disparo em massa, respostas rápidas e gestão de equipe — tudo dentro do seu WhatsApp Web, em uma extensão de Chrome.",
      },
      { property: "og:title", content: "CRM completo para barbearias dentro do WhatsApp" },
      {
        property: "og:description",
        content:
          "Assinaturas, vendas, funis, disparo em massa, respostas rápidas e gestão de equipe — tudo dentro do seu WhatsApp Web, em uma extensão de Chrome.",
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

const DORES = [
  "Cliente e assinante espalhados entre planilha, agenda e caderno",
  "Cobrança e follow-up feitos na mão, um por um, no WhatsApp",
  "Nenhum funil: o orçamento some na conversa e ninguém retoma",
  "Sem controle de vendas por barbeiro nem histórico do cliente",
];

const RECURSOS = [
  {
    titulo: "Gestão de assinaturas",
    texto:
      "Kanban de ativos, a vencer, inadimplentes e cancelados, com meta do mês e faturamento por coluna.",
  },
  {
    titulo: "Funis de vendas",
    texto:
      "Funil próprio e listas reais do WhatsApp, arrastando o lead de etapa em etapa direto na conversa.",
  },
  {
    titulo: "Disparo em massa",
    texto:
      "Campanhas com texto, imagem, áudio e vídeo em ritmo humano, sem abrir conversa por conversa.",
  },
  {
    titulo: "Respostas rápidas",
    texto:
      "Atalho ⚡ dentro da conversa para enviar mensagens e mídias prontas de cobrança, orçamento e reativação.",
  },
  {
    titulo: "Gestão de equipe e vendas",
    texto:
      "Lançamento de venda por barbeiro, ranking gamificado, ranking de clientes e histórico de consumo.",
  },
  {
    titulo: "Base de clientes unificada",
    texto:
      "Importação de planilha (App Barber, Cash Barber, Frizzar), contatos do WhatsApp e cadastro manual, sem duplicar.",
  },
];

const PASSOS = [
  { n: "1", t: "Crie sua conta", d: "Nome, e-mail e o WhatsApp da barbearia. Leva menos de um minuto." },
  { n: "2", t: "Adicione ao Chrome", d: "Instalação em um clique — nada pra configurar em servidor." },
  { n: "3", t: "Abra o WhatsApp Web", d: "O CRM aparece colado na tela, reconhece seu número e já funciona." },
];

const FAQ = [
  {
    q: "Precisa de outro número de WhatsApp?",
    a: "Não. O CRM usa a sua própria sessão do WhatsApp Web, o mesmo número que você já usa na barbearia.",
  },
  {
    q: "Meus contatos ficam salvos onde?",
    a: "Na sua conta do CRM, isolada por barbearia. Ninguém além de você acessa a sua base.",
  },
  {
    q: "Consigo testar antes de pagar?",
    a: `Sim. O plano grátis libera até ${FREE_LIMITS.customers} contatos e disparos de até ${FREE_LIMITS.dispatchBatch} contatos por vez. Gestão de equipe e disparo em massa são do plano pago.`,
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Pode. A assinatura é mensal, sem fidelidade, e você cancela pelo próprio painel.",
  },
];


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
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-3">
          <img src={zettaLogo.url} alt="Zetta CRM" className="h-5 w-auto" />
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-6 md:gap-10 md:py-24 md:grid-cols-2 md:items-center">
        <div className="space-y-4 md:space-y-6">
          <span className="hidden md:inline-block rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-[11px] font-semibold tracking-wider text-yellow-400">
            OFERTA DE LANÇAMENTO · 5 VAGAS
          </span>
          <h1 className="order-1 text-2xl font-bold leading-[1.15] tracking-tight sm:text-4xl md:order-none md:text-5xl md:leading-[1.08]">
            O CRM completo da sua barbearia{" "}
            <span className="text-yellow-400">dentro do WhatsApp</span>
          </h1>
          <p className="hidden md:block text-lg text-neutral-300">
            Assinaturas, vendas, funis, disparo em massa, respostas rápidas e gestão de equipe —
            tudo em um só lugar, no seu próprio número, sem trocar de ferramenta e sem abrir
            conversa por conversa.
          </p>
          <div className="order-3 flex flex-wrap items-center gap-3 md:order-none">
            <Button size="lg" className="bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300" onClick={scrollToForm}>
              QUERO TESTAR GRÁTIS
            </Button>
            <span className="text-xs text-neutral-400">
              Sem cartão para começar · {PROMO_PRICE_LABEL} no lançamento (depois {PREMIUM_PRICE_LABEL})
            </span>
          </div>

          <div className="hidden md:flex flex-wrap gap-6 pt-2 text-sm text-neutral-400">
            <span>✓ Usa seu número atual</span>
            <span>✓ Instala em 1 clique</span>
            <span>✓ Cancela quando quiser</span>
          </div>
        </div>

        {/* Vídeo de vendas */}
        <div className="order-2 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl md:order-none md:rounded-3xl">
          <div className="relative aspect-video w-full">
            <iframe
              src="https://www.youtube.com/embed/QJYO1QX-tKQ"
              title="Zetta CRM — vídeo de apresentação"
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </div>
      </section>

      {/* Dores */}
      <section className="border-y border-white/10 bg-neutral-900/50">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Se você se identifica com isso, o problema não é o seu time — é a falta de processo
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {DORES.map((d) => (
              <li key={d} className="flex items-start gap-3 rounded-xl border border-white/10 bg-neutral-950 p-4">
                <span className="mt-0.5 text-red-400">✕</span>
                <span className="text-sm text-neutral-300">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Tudo que você precisa, <span className="text-yellow-400">sem sair do WhatsApp</span>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {RECURSOS.map((r) => (
            <div key={r.titulo} className="rounded-2xl border border-white/10 bg-neutral-900 p-5">
              <h3 className="font-semibold text-yellow-400">{r.titulo}</h3>
              <p className="mt-2 text-sm text-neutral-300">{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Passos */}
      <section className="border-y border-white/10 bg-neutral-900/50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Funcionando em 3 minutos</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PASSOS.map((p) => (
              <div key={p.n} className="rounded-2xl border border-white/10 bg-neutral-950 p-6">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-yellow-400 text-lg font-bold text-neutral-950">
                  {p.n}
                </span>
                <h3 className="mt-4 font-semibold">{p.t}</h3>
                <p className="mt-1 text-sm text-neutral-400">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Comece grátis. Assine quando fizer sentido.
        </h2>
        <p className="mt-3 text-center text-sm text-yellow-400">
          Oferta de lançamento: {PROMO_PRICE_LABEL} para as 5 primeiras barbearias (depois {PREMIUM_PRICE_LABEL}).
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-neutral-900 p-6">
            <p className="text-sm font-semibold text-neutral-400">Grátis</p>
            <p className="mt-2 text-3xl font-bold">R$ 0</p>
            <ul className="mt-5 space-y-2 text-sm text-neutral-300">
              <li>✓ Até {FREE_LIMITS.customers} contatos</li>
              <li>✓ Disparo de até {FREE_LIMITS.dispatchBatch} contatos por vez</li>
              <li>✓ Kanban, funis e importação de planilha</li>
              <li className="text-neutral-500">✕ Gestão de equipe e vendas</li>
            </ul>
            <Button variant="secondary" className="mt-6 w-full" onClick={scrollToForm}>
              Instalar extensão
            </Button>
          </div>
          <div className="rounded-2xl border-2 border-yellow-400 bg-neutral-900 p-6">
            <p className="text-sm font-semibold text-yellow-400">Premium · lançamento</p>
            <p className="mt-2 text-3xl font-bold">
              R$ 47<span className="text-base font-medium text-neutral-400">/mês</span>
              <span className="ml-2 align-middle text-sm font-medium text-neutral-500 line-through">R$ 97</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-neutral-200">
              <li>✓ Contatos ilimitados</li>
              <li>✓ Disparos e campanhas ilimitados</li>
              <li>✓ Gestão de equipe, vendas e rankings</li>
              <li>✓ Respostas rápidas com mídia</li>
              <li>✓ Suporte prioritário</li>
            </ul>
            <Button
              className="mt-6 w-full bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
              onClick={scrollToForm}
            >
              Garantir vaga de lançamento
            </Button>
          </div>
        </div>
      </section>


      {/* FAQ */}
      <section className="border-t border-white/10 bg-neutral-900/50">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Perguntas frequentes</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-white/10 bg-neutral-950 p-5">
                <p className="font-semibold text-yellow-400">{f.q}</p>
                <p className="mt-2 text-sm text-neutral-300">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cadastro */}
      <section id="cadastro" className="px-5 py-20">
        <div className="mx-auto max-w-md rounded-3xl border border-yellow-400/30 bg-neutral-900 p-7">
          <h2 className="text-2xl font-bold tracking-tight">Instale e comece grátis</h2>
          <p className="mt-2 text-sm text-neutral-400">
            Preencha seus dados para liberar a instalação da extensão. Leva menos de um minuto.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
            <Button
              type="submit"
              size="lg"
              className="w-full bg-yellow-400 font-bold text-neutral-950 hover:bg-yellow-300"
              disabled={loading}
            >
              {loading ? "Enviando…" : "ADICIONAR AO CHROME"}
            </Button>
            <p className="text-center text-[11px] text-neutral-500">
              Use o mesmo número do WhatsApp da barbearia — é ele que faz o pareamento.
            </p>
          </form>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-xs text-neutral-500">
          <span>Zetta CRM · CRM de assinaturas para barbearias</span>
          <Link to="/politicas" className="text-neutral-400 transition-colors hover:text-yellow-400">
            Política de Privacidade e Termos de Uso
          </Link>
        </div>
      </footer>
    </div>
  );
}
