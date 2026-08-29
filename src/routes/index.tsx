import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PREMIUM_PRICE_LABEL, FREE_LIMITS } from "@/lib/billing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zaylo CRM | CRM completo dentro do WhatsApp" },
      {
        name: "description",
        content:
          "CRM completo integrado ao WhatsApp: disparo em massa, agente de IA, funis, automações, agenda, respostas rápidas, treinamentos e gestão de equipe para sua empresa vender mais.",
      },
      { property: "og:title", content: "Zaylo CRM | CRM completo dentro do WhatsApp" },
      {
        property: "og:description",
        content:
          "CRM completo integrado ao WhatsApp: disparo em massa, agente de IA, funis, automações, agenda, respostas rápidas, treinamentos e gestão de equipe para sua empresa vender mais.",
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
  "Leads chegam no WhatsApp e se perdem no meio das conversas",
  "Follow-up e cobrança feitos na mão, um cliente por vez",
  "Nenhum funil: o orçamento some na conversa e ninguém retoma",
  "Sem controle de vendas por vendedor, nem histórico do cliente",
];

const RECURSOS = [
  {
    titulo: "Disparo em massa",
    texto:
      "Campanhas com texto, imagem, áudio e vídeo em ritmo humano, direto do seu número, sem abrir conversa por conversa.",
  },
  {
    titulo: "Agente de IA",
    texto:
      "IA que entende a intenção do cliente, responde, qualifica o lead e move o card no funil sozinha.",
  },
  {
    titulo: "Funis de vendas",
    texto:
      "Funis próprios e listas reais do WhatsApp, arrastando o lead de etapa em etapa dentro da conversa.",
  },
  {
    titulo: "Automações",
    texto:
      "Follow-up, lembrete e reativação disparando na hora certa, sem ninguém precisar lembrar.",
  },
  {
    titulo: "Agenda e agendamento online",
    texto:
      "Agenda por profissional, bloqueios, status do atendimento e link público para o cliente agendar sozinho.",
  },
  {
    titulo: "Respostas rápidas",
    texto:
      "Atalho ⚡ dentro da conversa para enviar mensagens e mídias prontas de cobrança, orçamento e reativação.",
  },
  {
    titulo: "Equipe e vendas",
    texto:
      "Lançamento de venda por vendedor, ranking gamificado, ranking de clientes e histórico de consumo.",
  },
  {
    titulo: "Treinamentos e aulas",
    texto:
      "Área de aulas dentro do próprio CRM para treinar o time e colocar todo mundo vendendo do mesmo jeito.",
  },
  {
    titulo: "Base de clientes unificada",
    texto:
      "Importação de planilha, contatos do WhatsApp e cadastro manual em uma base só, sem duplicar contato.",
  },
];

const PASSOS = [
  { n: "1", t: "Crie sua conta", d: "Nome, e-mail e o WhatsApp da empresa. Leva menos de um minuto." },
  { n: "2", t: "Adicione ao Chrome", d: "Instalação em um clique, sem nada pra configurar em servidor." },
  { n: "3", t: "Abra o WhatsApp Web", d: "O CRM aparece colado na tela, reconhece seu número e já funciona." },
];

const FAQ = [
  {
    q: "Precisa de outro número de WhatsApp?",
    a: "Não. O CRM usa a sua própria sessão do WhatsApp Web, o mesmo número que a sua empresa já usa.",
  },
  {
    q: "Serve para qualquer tipo de empresa?",
    a: "Sim. Se o seu atendimento e a sua venda acontecem no WhatsApp, o Zaylo CRM se encaixa: serviços, comércio, clínicas, agências e assinaturas.",
  },
  {
    q: "Meus contatos ficam salvos onde?",
    a: "Na sua conta do CRM, isolada por empresa. Ninguém além de você acessa a sua base.",
  },
  {
    q: "Consigo testar antes de pagar?",
    a: `Sim. O plano grátis libera até ${FREE_LIMITS.customers} contatos e disparos de até ${FREE_LIMITS.dispatchBatch} contatos por vez. Disparo em massa e gestão de equipe são do plano pago.`,
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
    <div className="min-h-screen bg-[#0a1120] text-slate-100">
      {/* Top bar */}
      <header className="border-b border-white/10 bg-[#0a1120]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <img src="/brand/zaylo-logo.png" alt="Zaylo CRM" className="h-7 w-auto object-contain" />
          <button
            onClick={scrollToForm}
            className="rounded-lg bg-[#2f6df6] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1f5ae0]"
          >
            COMEÇAR GRÁTIS
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#2f6df6]/20 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-5 py-16 text-center md:py-24">
          <span className="inline-block rounded-full border border-[#8fb6ff]/40 bg-[#2f6df6]/10 px-3 py-1 text-[11px] font-semibold tracking-wider text-[#8fb6ff]">
            CRM · IA · AUTOMAÇÃO NO WHATSAPP
          </span>
          <h1 className="mt-5 text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl">
            O CRM completo integrado ao{" "}
            <span className="text-[#4f8bff]">WhatsApp</span> para sua empresa vender mais
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-slate-300 md:text-lg">
            Disparo em massa, agente de IA, funis, automações, agenda, respostas rápidas,
            treinamentos e gestão de equipe, tudo dentro do WhatsApp que você já usa, sem trocar de
            ferramenta e sem abrir conversa por conversa.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="w-full max-w-[280px] bg-[#2f6df6] px-8 py-5 text-base font-bold text-white hover:bg-[#1f5ae0]"
              onClick={scrollToForm}
            >
              QUERO TESTAR GRÁTIS
            </Button>
            <span className="text-xs text-slate-400">
              Sem cartão para começar · {PREMIUM_PRICE_LABEL} quando quiser liberar tudo
            </span>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-400">
            <span>✓ Usa seu número atual</span>
            <span>✓ Instala em 1 clique</span>
            <span>✓ Cancela quando quiser</span>
          </div>
        </div>
      </section>

      {/* Dores */}
      <section className="border-y border-white/10 bg-[#0d1830]">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Se você se identifica com isso, o problema não é o seu time. É a falta de processo
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {DORES.map((d) => (
              <li
                key={d}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-[#0a1120] p-4"
              >
                <span className="mt-0.5 text-rose-400">✕</span>
                <span className="text-sm text-slate-300">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Tudo que sua operação precisa, <span className="text-[#4f8bff]">sem sair do WhatsApp</span>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {RECURSOS.map((r) => (
            <div
              key={r.titulo}
              className="rounded-2xl border border-white/10 bg-[#0d1830] p-5 transition hover:border-[#2f6df6]/50"
            >
              <h3 className="font-semibold text-[#8fb6ff]">{r.titulo}</h3>
              <p className="mt-2 text-sm text-slate-300">{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Passos */}
      <section className="border-y border-white/10 bg-[#0d1830]">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Funcionando em 3 minutos</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PASSOS.map((p) => (
              <div key={p.n} className="rounded-2xl border border-white/10 bg-[#0a1120] p-6">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2f6df6] text-lg font-bold text-white">
                  {p.n}
                </span>
                <h3 className="mt-4 font-semibold">{p.t}</h3>
                <p className="mt-1 text-sm text-slate-400">{p.d}</p>
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
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#0d1830] p-6">
            <p className="text-sm font-semibold text-slate-400">Grátis</p>
            <p className="mt-2 text-3xl font-bold">R$ 0</p>
            <ul className="mt-5 space-y-2 text-sm text-slate-300">
              <li>✓ Até {FREE_LIMITS.customers} contatos</li>
              <li>✓ Disparo de até {FREE_LIMITS.dispatchBatch} contatos por vez</li>
              <li>✓ Funis, agenda e importação de planilha</li>
              <li className="text-slate-500">✕ Gestão de equipe e vendas</li>
            </ul>
            <Button variant="secondary" className="mt-6 w-full" onClick={scrollToForm}>
              Instalar extensão
            </Button>
          </div>
          <div className="rounded-2xl border-2 border-[#2f6df6] bg-[#0d1830] p-6 shadow-[0_0_60px_-20px_#2f6df6]">
            <p className="text-sm font-semibold text-[#8fb6ff]">Premium</p>
            <p className="mt-2 text-3xl font-bold">
              R$ 97<span className="text-base font-medium text-slate-400">/mês</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-200">
              <li>✓ Contatos ilimitados</li>
              <li>✓ Disparos e campanhas ilimitados</li>
              <li>✓ Funis, automações e agenda completos</li>
              <li>✓ Gestão de equipe, vendas e rankings</li>
              <li>✓ Respostas rápidas com mídia e treinamentos</li>
              <li>✓ Suporte prioritário</li>
            </ul>
            <Button
              className="mt-6 w-full bg-[#2f6df6] font-bold text-white hover:bg-[#1f5ae0]"
              onClick={scrollToForm}
            >
              Quero o Premium
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-white/10 bg-[#0d1830]">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight">Perguntas frequentes</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-white/10 bg-[#0a1120] p-5">
                <p className="font-semibold text-[#8fb6ff]">{f.q}</p>
                <p className="mt-2 text-sm text-slate-300">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cadastro */}
      <section id="cadastro" className="px-5 py-20">
        <div className="mx-auto max-w-md rounded-3xl border border-[#2f6df6]/40 bg-[#0d1830] p-7">
          <h2 className="text-2xl font-bold tracking-tight">Instale e comece grátis</h2>
          <p className="mt-2 text-sm text-slate-400">
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
              className="w-full bg-[#2f6df6] font-bold text-white hover:bg-[#1f5ae0]"
              disabled={loading}
            >
              {loading ? "Enviando…" : "ADICIONAR AO CHROME"}
            </Button>
            <p className="text-center text-[11px] text-slate-500">
              Use o mesmo número do WhatsApp da empresa. É ele que faz o pareamento.
            </p>
          </form>
        </div>
      </section>

      <footer className="border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-xs text-slate-500">
          <span>Zaylo CRM · CRM completo integrado ao WhatsApp</span>
          <Link to="/politicas" className="text-slate-400 transition-colors hover:text-[#8fb6ff]">
            Política de Privacidade e Termos de Uso
          </Link>
        </div>
      </footer>
    </div>
  );
}
