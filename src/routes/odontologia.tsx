import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { PREMIUM_PRICE_LABEL, FREE_LIMITS } from "@/lib/billing";

export const Route = createFileRoute("/odontologia")({
  head: () => ({
    meta: [
      { title: "Zaylo CRM | Sistema completo para clínica odontológica" },
      {
        name: "description",
        content:
          "Prontuário com odontograma interativo, anexo de radiografia, agenda multiprofissional, lembrete e confirmação automática, orçamento por paciente e CRM completo, tudo integrado ao WhatsApp da sua clínica.",
      },
      { property: "og:title", content: "Zaylo CRM | Sistema completo para clínica odontológica" },
      {
        property: "og:description",
        content:
          "Prontuário com odontograma interativo, anexo de radiografia, agenda multiprofissional, lembrete e confirmação automática, orçamento por paciente e CRM completo, tudo integrado ao WhatsApp da sua clínica.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingOdonto,
});

const formSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome").max(120),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: z.string().trim().min(8, "Telefone inválido").max(20),
});

const DORES = [
  "Prontuário em papel, ficha perdida, letra de outro dentista que ninguém entende",
  "Radiografia e ficha antiga espalhadas, sem jeito de achar rápido na hora da consulta",
  "Paciente não sabe quanto já pagou nem o que ainda falta fazer",
  "Confirmação de consulta feita na mão, uma por uma, e mesmo assim falta gente",
];

const RECURSOS = [
  {
    titulo: "Odontograma interativo",
    texto:
      "Ficha visual da arcada, dente por dente. Marca cárie, restauração, implante, extração, tudo clicando no dente certo, sem letra ilegível.",
  },
  {
    titulo: "Prontuário e anexos",
    texto:
      "Radiografia, ficha antiga, qualquer documento do paciente anexado direto na ficha dele, com data e organizado do primeiro ao último.",
  },
  {
    titulo: "Histórico de visitas e orçamento",
    texto:
      "Cada visita registrada com o que foi feito, em qual dente, quanto custou e se já foi pago. O orçamento do paciente se monta sozinho.",
  },
  {
    titulo: "Agenda multiprofissional",
    texto:
      "Agenda por dentista, bloqueios de horário, status do atendimento e link público para o paciente marcar sozinho.",
  },
  {
    titulo: "Lembrete e confirmação automática",
    texto:
      "A clínica manda lembrete e recebe a confirmação sozinha, sem ninguém precisar ligar pra cada paciente.",
  },
  {
    titulo: "Funil de pacientes e vendas",
    texto:
      "Do primeiro contato até o tratamento fechado, cada paciente numa etapa, sem se perder no meio das conversas do WhatsApp.",
  },
  {
    titulo: "Disparo em massa",
    texto:
      "Campanha de reativação, aniversário ou aviso de retorno, direto do número da clínica, sem abrir conversa por conversa.",
  },
  {
    titulo: "Agente de IA",
    texto:
      "IA que responde a primeira mensagem do paciente, qualifica e já encaminha pro funil certo, mesmo fora do horário de atendimento.",
  },
  {
    titulo: "Base de pacientes unificada",
    texto:
      "Importação de planilha, contatos do WhatsApp e cadastro manual numa base só, sem duplicar paciente.",
  },
];

const PASSOS = [
  { n: "1", t: "Crie sua conta", d: "Nome, e-mail e o WhatsApp da clínica. Leva menos de um minuto." },
  { n: "2", t: "Adicione ao Chrome", d: "Instalação em um clique, sem nada pra configurar em servidor." },
  { n: "3", t: "Abra o WhatsApp Web", d: "O sistema aparece colado na tela, já configurado pra odontologia." },
];

const FAQ = [
  {
    q: "O prontuário odontológico é dado sensível de saúde. Como fica a segurança?",
    a: "Cada clínica tem a base isolada da outra, e os anexos (radiografia, documento) ficam num espaço privado, sem acesso público. Ninguém além da sua clínica vê o prontuário dos seus pacientes.",
  },
  {
    q: "Precisa de outro número de WhatsApp?",
    a: "Não. O sistema usa a sua própria sessão do WhatsApp Web, o mesmo número que a clínica já usa.",
  },
  {
    q: "O odontograma substitui o prontuário em papel?",
    a: "Sim. É uma ficha visual da arcada, dente por dente, com registro de procedimento, data e valor, tudo dentro do mesmo cadastro do paciente.",
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

function LandingOdonto() {
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
        body: JSON.stringify({ ...parsed.data, business_type: "odontologia" }),
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
    <div className="min-h-screen bg-white text-slate-800">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <img src="/brand/zaylo-logo.png" alt="Zaylo CRM" className="h-7 w-auto object-contain" />
          <button
            onClick={scrollToForm}
            className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700"
          >
            COMEÇAR GRÁTIS
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-teal-50/60">
        <div className="mx-auto max-w-4xl px-5 py-16 text-center md:py-24">
          <span className="inline-block rounded-full border border-teal-600/30 bg-white px-3 py-1 text-[11px] font-semibold tracking-wider text-teal-700">
            SISTEMA PARA CLÍNICA ODONTOLÓGICA
          </span>
          <h1 className="mt-5 text-3xl font-bold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl md:text-6xl">
            Prontuário, odontograma e agenda da sua clínica,{" "}
            <span className="text-teal-600">tudo dentro do WhatsApp</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-slate-600 md:text-lg">
            Odontograma interativo, anexo de radiografia, orçamento por paciente, agenda por dentista,
            confirmação automática e CRM completo, sem trocar de ferramenta e sem perder paciente no meio
            das conversas.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              size="lg"
              className="w-full max-w-[280px] bg-teal-600 px-8 py-5 text-base font-bold text-white hover:bg-teal-700"
              onClick={scrollToForm}
            >
              QUERO TESTAR GRÁTIS
            </Button>
            <span className="text-xs text-slate-500">
              Sem cartão para começar · {PREMIUM_PRICE_LABEL} quando quiser liberar tudo
            </span>
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <span>✓ Usa o número da clínica</span>
            <span>✓ Instala em 1 clique</span>
            <span>✓ Cancela quando quiser</span>
          </div>
        </div>
      </section>

      {/* Dores */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Se a sua clínica se identifica com isso, o problema não é a equipe. É a falta de sistema
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {DORES.map((d) => (
              <li
                key={d}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <span className="mt-0.5 text-rose-500">✕</span>
                <span className="text-sm text-slate-600">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Tudo que a sua clínica precisa, <span className="text-teal-600">num lugar só</span>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {RECURSOS.map((r) => (
            <div
              key={r.titulo}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-teal-500/50"
            >
              <h3 className="font-semibold text-teal-700">{r.titulo}</h3>
              <p className="mt-2 text-sm text-slate-600">{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Passos */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Funcionando em 3 minutos</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PASSOS.map((p) => (
              <div key={p.n} className="rounded-2xl border border-slate-200 bg-white p-6">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-600 text-lg font-bold text-white">
                  {p.n}
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{p.t}</h3>
                <p className="mt-1 text-sm text-slate-500">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Planos */}
      <section className="mx-auto max-w-5xl px-5 py-16">
        <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Comece grátis. Assine quando fizer sentido.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <p className="text-sm font-semibold text-slate-500">Grátis</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">R$ 0</p>
            <ul className="mt-5 space-y-2 text-sm text-slate-600">
              <li>✓ Até {FREE_LIMITS.customers} contatos</li>
              <li>✓ Disparo de até {FREE_LIMITS.dispatchBatch} contatos por vez</li>
              <li>✓ Odontograma, prontuário, anexos e agenda</li>
              <li className="text-slate-400">✕ Gestão de equipe e vendas</li>
            </ul>
            <Button variant="secondary" className="mt-6 w-full" onClick={scrollToForm}>
              Instalar extensão
            </Button>
          </div>
          <div className="rounded-2xl border-2 border-teal-600 bg-white p-6 shadow-[0_0_60px_-20px_theme(colors.teal.400)]">
            <p className="text-sm font-semibold text-teal-700">Premium</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              R$ 97<span className="text-base font-medium text-slate-400">/mês</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-700">
              <li>✓ Pacientes ilimitados</li>
              <li>✓ Disparos e campanhas ilimitados</li>
              <li>✓ Odontograma, prontuário, anexos e agenda completos</li>
              <li>✓ Orçamento e histórico de visitas por paciente</li>
              <li>✓ Lembrete e confirmação automática</li>
              <li>✓ Suporte prioritário</li>
            </ul>
            <Button
              className="mt-6 w-full bg-teal-600 font-bold text-white hover:bg-teal-700"
              onClick={scrollToForm}
            >
              Quero o Premium
            </Button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Perguntas frequentes</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="font-semibold text-teal-700">{f.q}</p>
                <p className="mt-2 text-sm text-slate-600">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cadastro */}
      <section id="cadastro" className="px-5 py-20">
        <div className="mx-auto max-w-md rounded-3xl border border-teal-600/30 bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Instale e comece grátis</h2>
          <p className="mt-2 text-sm text-slate-500">
            Preencha os dados da clínica para liberar a instalação. Leva menos de um minuto.
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
              <Label htmlFor="phone">WhatsApp da clínica (com DDD)</Label>
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
              className="w-full bg-teal-600 font-bold text-white hover:bg-teal-700"
              disabled={loading}
            >
              {loading ? "Enviando…" : "ADICIONAR AO CHROME"}
            </Button>
            <p className="text-center text-[11px] text-slate-400">
              Use o mesmo número do WhatsApp da clínica. É ele que faz o pareamento.
            </p>
          </form>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-xs text-slate-400">
          <span>Zaylo CRM · Sistema completo para clínica odontológica</span>
          <Link to="/politicas" className="text-slate-500 transition-colors hover:text-teal-700">
            Política de Privacidade e Termos de Uso
          </Link>
        </div>
      </footer>
    </div>
  );
}
