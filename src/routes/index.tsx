import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FREE_LIMITS } from "@/lib/billing";
import { MobileMockup } from "@/components/ui/whatsapp-mobile-mockup";
import { InfiniteMovingCards } from "@/components/ui/infinite-moving-cards";
import { DispatchSimulator } from "@/components/ui/dispatch-simulator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Zaylo CRM | O motor que sua clínica precisa pra vender mais" },
      {
        name: "description",
        content:
          "CRM dentro do WhatsApp pra clínicas que investem em tráfego pago: disparo em massa, agente de IA, funis, automações, agenda, respostas rápidas, treinamentos e gestão de equipe. Nenhum lead se perde.",
      },
      { property: "og:title", content: "Zaylo CRM | O motor que sua clínica precisa pra vender mais" },
      {
        property: "og:description",
        content:
          "CRM dentro do WhatsApp pra clínicas que investem em tráfego pago: disparo em massa, agente de IA, funis, automações, agenda, respostas rápidas, treinamentos e gestão de equipe. Nenhum lead se perde.",
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
  business_type: z.enum(["barbearia", "odontologia", "estetica", "outros"], {
    errorMap: () => ({ message: "Escolha o tipo do seu negócio" }),
  }),
});

const DORES = [
  "Você investe em tráfego, mas o lead esfria no meio da conversa do WhatsApp",
  "Follow-up e cobrança feitos na mão, um paciente por vez",
  "Nenhum funil: o orçamento some na conversa e ninguém retoma",
  "Sem histórico organizado do paciente, cada atendente vê uma parte diferente da conversa",
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
      "IA que entende a intenção do paciente, responde, qualifica o lead e move o card no funil sozinha.",
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
      "Agenda por profissional, bloqueios, status do atendimento e link público para o paciente agendar sozinho.",
  },
  {
    titulo: "Respostas rápidas",
    texto:
      "Atalho ⚡ dentro da conversa para enviar mensagens e mídias prontas de cobrança, orçamento e reativação.",
  },
  {
    titulo: "Ficha e histórico do paciente",
    texto:
      "Anamnese, odontograma e histórico de procedimentos organizados por paciente, acessíveis por toda a equipe.",
  },
  {
    titulo: "Treinamentos e aulas",
    texto:
      "Área de aulas dentro do próprio CRM para treinar a equipe e manter todo mundo alinhado no mesmo processo.",
  },
  {
    titulo: "Base de pacientes unificada",
    texto:
      "Importação de planilha, contatos do WhatsApp e cadastro manual em uma base só, sem duplicar contato.",
  },
];

// PENDENTE: substituir pelos depoimentos reais das clínicas que já
// usam o sistema antes de publicar. Nome e clínica genéricos de
// propósito, pra não passar como se fosse cliente de verdade.
// FICTÍCIO — a pedido do Mariano, só pra visualizar o layout. Precisa
// virar depoimento real (nome, clínica e texto de verdade, com
// autorização do cliente) antes de publicar de vez.
// FICTÍCIO — a pedido do Mariano, só pra visualizar o layout. Precisa
// virar depoimento real (nome, clínica e texto de verdade, com
// autorização do cliente) antes de publicar de vez.
const DEPOIMENTOS = [
  {
    name: "Dra. Camila Vasconcelos",
    title: "Sorriso+ Odontologia",
    iniciais: "CV",
    quote: "Antes eu perdia lead no meio da conversa porque ninguém retomava o orçamento. Hoje o sistema já lembra sozinho.",
  },
  {
    name: "Rafael Nogueira",
    title: "Prótese capilar RN Hair",
    iniciais: "RN",
    quote: "O agente de IA qualifica o lead antes de eu nem ver a mensagem. Chega pronto pra eu fechar.",
  },
  {
    name: "Dra. Beatriz Andrade",
    title: "Clínica Andrade Estética",
    iniciais: "BA",
    quote: "A agenda com lembrete automático cortou boa parte das faltas. Isso sozinho já pagou o sistema.",
  },
  {
    name: "Dr. Thiago Salles",
    title: "Clínica Salles Odontologia",
    iniciais: "TS",
    quote: "Consigo ver o histórico completo do paciente numa tela só, mesmo quando outro dentista atendeu antes de mim.",
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
    q: "Serve só para clínicas?",
    a: "O foco é clínica odontológica, de estética e de prótese capilar, negócios que investem em tráfego pago e não podem perder lead. Mas se o seu atendimento e sua venda acontecem no WhatsApp, o Zaylo CRM também se encaixa.",
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
  // Fase atual do negócio: página só serve o CRM genérico, sem
  // seletor de nicho — decidido pelo Mariano pra reduzir trabalho
  // duplicado (vídeo, criativos) enquanto ainda não escalou. Nicho
  // específico volta a ser escolhido dentro do admin, cliente por
  // cliente, quando fizer sentido.
  const [form, setForm] = useState({ name: "", email: "", phone: "", business_type: "outros" as "barbearia" | "odontologia" | "estetica" | "outros" });
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
    // Tema claro — pedido do Mariano pra sair do "dark mode genérico"
    // que a maioria dos concorrentes usa. Azul da marca mantido como
    // única cor de destaque, contra fundo claro.
    // Fundo com padrão de pontos sutil (mesma técnica usada em página
    // premium tipo Vercel/Linear) + brilho azul no topo — a tentativa
    // anterior (gradiente quase invisível) não resolveu, isso aqui é
    // visualmente perceptível sem competir com o conteúdo.
    <div className="relative min-h-screen bg-white text-slate-900">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.4]"
        style={{
          backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
        }}
      />
      <div className="relative z-10">
      {/* Top bar */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center px-5 py-3">
          <img src="/brand/zaylo-logo.png" alt="Zaylo CRM" className="h-7 w-auto object-contain" />
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-[#2f6df6]/10 blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-5 pt-10 text-center md:pt-14">
          <h1 className="text-3xl font-bold leading-[1.2] tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
            O CRM que a sua <span className="text-[#2f6df6]">clínica</span> precisa para vender mais todos os dias!
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 md:text-lg">
            Tudo em um só lugar: disparos, funis, agenda, follow up, agentes de IA e treinamentos.
          </p>
        </div>
      </section>

      {/* Vídeo de demonstração — vídeo real do Mariano no YouTube. Menor
       * que a largura total do Hero, pra não dominar a primeira dobra. */}
      <section className="mx-auto max-w-2xl px-5 pt-6 pb-10">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="relative aspect-video w-full">
            <iframe
              src="https://www.youtube.com/embed/Od2D8ncTtMw"
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title="Veja o CRM funcionando"
            />
          </div>
        </div>
      </section>

      {/* CTA logo abaixo do vídeo — depois de ver a aula, o próximo
       * passo natural é começar. Teste grátis funciona como a garantia
       * (sem cobrança de reembolso separada, pedido do Mariano). */}
      <section className="mx-auto max-w-4xl px-5 pb-16 text-center">
        <Button
          size="lg"
          className="w-full max-w-[280px] bg-[#2f6df6] px-8 py-5 text-base font-bold text-white hover:bg-[#1f5ae0]"
          onClick={scrollToForm}
        >
          QUERO TESTAR GRÁTIS
        </Button>
        <p className="mt-3 text-xs text-slate-500">Teste sem compromisso!</p>
      </section>

      {/* Dores */}
      <section className="border-y border-slate-200 bg-[#f5f7fb]">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Se sua clínica se identifica com isso, o problema não é o seu time. É a falta de processo
          </h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {DORES.map((d) => (
              <li
                key={d}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <span className="mt-0.5 text-rose-500">✕</span>
                <span className="text-sm text-slate-700">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Recursos */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Tudo que sua clínica precisa, <span className="text-[#2f6df6]">sem sair do WhatsApp</span>
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {RECURSOS.map((r) => (
            <div
              key={r.titulo}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#2f6df6]/40 hover:shadow-md"
            >
              <h3 className="font-semibold text-[#2f6df6]">{r.titulo}</h3>
              <p className="mt-2 text-sm text-slate-600">{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Simulação de disparo em massa — mostra a campanha rodando de
       * verdade (contato ganhando check um a um, barra de progresso),
       * em vez de só descrever "disparo em massa" em texto. */}
      <section className="border-y border-slate-200 bg-[#f5f7fb]">
        <div className="mx-auto max-w-4xl px-5 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Uma campanha, centenas de contatos, sem abrir conversa por conversa
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-slate-600">
            Escreve a mensagem uma vez, escolhe a lista, e acompanha o envio em tempo real.
          </p>
          <div className="mt-10">
            <DispatchSimulator />
          </div>
        </div>
      </section>

      {/* Celular com a IA atendendo — mostra o produto em ação em vez de
       * só descrever em texto. Anotações flutuantes ao lado apontam pro
       * que está acontecendo em cada momento da conversa. */}
      <section className="border-y border-slate-200 bg-[#f5f7fb]">
        <div className="mx-auto max-w-5xl px-5 py-16">
          <h2 className="text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Enquanto você atende quem já está na cadeira, a IA já está fechando o próximo horário
          </h2>
          <div className="mt-12 grid items-center gap-10 md:grid-cols-[minmax(0,280px)_1fr]">
            {/* Celular animado */}
            <MobileMockup />

            {/* Anotações do que aconteceu na conversa */}
            <div className="space-y-5">
              <div className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2f6df6]" />
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">A IA respondeu na hora</span>, sem o lead esperar
                  alguém ver a mensagem.
                </p>
              </div>
              <div className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2f6df6]" />
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">O horário já caiu na agenda</span> e o card desse
                  lead andou sozinho pro funil de "Agendado".
                </p>
              </div>
              <div className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#2f6df6]" />
                <p className="text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">O lembrete de 1h antes</span> vai sair sozinho, sem
                  ninguém precisar lembrar de mandar.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Depoimentos — PENDENTE: os 4 abaixo são fictícios, a pedido do
       * Mariano, só pra visualizar o layout. Precisam virar depoimento
       * real (nome, clínica e texto de verdade, com autorização do
       * cliente) antes de publicar de vez. Avatar fica como iniciais
       * por decisão do Mariano, não foto. */}
      <section className="py-16">
        <h2 className="mx-auto max-w-6xl px-5 text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Clínicas que já pararam de perder contato
        </h2>
        <div className="mt-10">
          <InfiniteMovingCards items={DEPOIMENTOS} direction="left" speed="slow" />
        </div>
      </section>

      {/* Passos */}
      <section className="border-y border-slate-200 bg-[#f5f7fb]">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Funcionando em 3 minutos</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {PASSOS.map((p) => (
              <div key={p.n} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2f6df6] text-lg font-bold text-white">
                  {p.n}
                </span>
                <h3 className="mt-4 font-semibold text-slate-900">{p.t}</h3>
                <p className="mt-1 text-sm text-slate-600">{p.d}</p>
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
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Grátis</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">R$ 0</p>
            <ul className="mt-5 space-y-2 text-sm text-slate-700">
              <li>✓ Até {FREE_LIMITS.customers} contatos</li>
              <li>✓ Disparo de até {FREE_LIMITS.dispatchBatch} contatos por vez</li>
              <li>✓ Funis, agenda e importação de planilha</li>
              <li className="text-slate-400">✕ Disparo em massa e treinamentos</li>
            </ul>
            <Button variant="secondary" className="mt-6 w-full" onClick={scrollToForm}>
              Instalar extensão
            </Button>
          </div>
          <div className="rounded-2xl border-2 border-[#2f6df6] bg-white p-6 shadow-xl shadow-[#2f6df6]/10">
            <p className="text-sm font-semibold text-[#2f6df6]">Premium</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              R$ 97<span className="text-base font-medium text-slate-500">/mês</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-slate-700">
              <li>✓ Contatos ilimitados</li>
              <li>✓ Disparos e campanhas ilimitados</li>
              <li>✓ Funis, automações e agenda completos</li>
              <li>✓ Ficha, anamnese e odontograma por paciente</li>
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
      <section className="border-t border-slate-200 bg-[#f5f7fb]">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Perguntas frequentes</h2>
          <div className="mt-8 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="font-semibold text-[#2f6df6]">{f.q}</p>
                <p className="mt-2 text-sm text-slate-600">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Cadastro */}
      <section id="cadastro" className="px-5 py-20">
        <div className="mx-auto max-w-md rounded-3xl border border-[#2f6df6]/30 bg-white p-7 shadow-xl shadow-slate-200/60">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Instale e comece grátis</h2>
          <p className="mt-2 text-sm text-slate-500">
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
            <p className="text-center text-[11px] text-slate-400">
              Use o mesmo número do WhatsApp da empresa. É ele que faz o pareamento.
            </p>
          </form>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 text-xs text-slate-500">
          <span>Zaylo CRM · O motor que sua clínica precisa pra vender mais</span>
          <Link to="/politicas" className="text-slate-500 transition-colors hover:text-[#2f6df6]">
            Política de Privacidade e Termos de Uso
          </Link>
        </div>
      </footer>
      </div>
    </div>
  );
}
