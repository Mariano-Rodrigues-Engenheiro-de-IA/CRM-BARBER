import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/politicas")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade e Termos — CRM Zaylo" },
      {
        name: "description",
        content:
          "Política de privacidade e termos de uso do Zetta CRM, extensão de Chrome para gestão de assinantes e campanhas no WhatsApp Web.",
      },
      { property: "og:title", content: "Política de Privacidade e Termos — CRM Zaylo" },
      {
        property: "og:description",
        content:
          "Como o Zetta CRM coleta, usa e protege seus dados, e as regras de uso da extensão.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "canonical", href: "https://buzz-boost-crm.lovable.app/politicas" },
    ],
  }),
  component: PoliticasPage,
});

const ATUALIZADO = "28 de julho de 2026";

function Topbar() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
        <Link to="/" className="text-[11px] font-semibold tracking-[0.28em] text-yellow-400">
          ZETTA CRM
        </Link>
        <Link
          to="/"
          className="rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-yellow-300"
        >
          VOLTAR
        </Link>
      </div>
    </header>
  );
}

function Section({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg font-bold tracking-tight text-yellow-400">{titulo}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

function PoliticasPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <Topbar />

      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Política de Privacidade e Termos de Uso</h1>
        <p className="mt-2 text-xs text-neutral-500">Última atualização: {ATUALIZADO}</p>

        {/* Sumário */}
        <nav className="mt-8 rounded-2xl border border-white/10 bg-neutral-900 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Sumário
          </p>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li><a href="#privacidade" className="text-neutral-300 hover:text-yellow-400">1. Política de Privacidade</a></li>
            <li><a href="#dados-coletados" className="text-neutral-300 hover:text-yellow-400">2. Dados que coletamos</a></li>
            <li><a href="#uso-dados" className="text-neutral-300 hover:text-yellow-400">3. Como usamos seus dados</a></li>
            <li><a href="#compartilhamento" className="text-neutral-300 hover:text-yellow-400">4. Compartilhamento</a></li>
            <li><a href="#armazenamento" className="text-neutral-300 hover:text-yellow-400">5. Armazenamento e segurança</a></li>
            <li><a href="#direitos" className="text-neutral-300 hover:text-yellow-400">6. Seus direitos (LGPD)</a></li>
            <li><a href="#cookies" className="text-neutral-300 hover:text-yellow-400">7. Cookies</a></li>
            <li><a href="#termos" className="text-neutral-300 hover:text-yellow-400">8. Termos de Uso</a></li>
            <li><a href="#uso-aceitavel" className="text-neutral-300 hover:text-yellow-400">9. Uso aceitável</a></li>
            <li><a href="#pagamentos" className="text-neutral-300 hover:text-yellow-400">10. Planos e pagamentos</a></li>
            <li><a href="#limitacao" className="text-neutral-300 hover:text-yellow-400">11. Limitação de responsabilidade</a></li>
            <li><a href="#contato" className="text-neutral-300 hover:text-yellow-400">12. Contato</a></li>
          </ul>
        </nav>

        <div className="mt-12 space-y-12">
          <Section id="privacidade" titulo="1. Política de Privacidade">
            <p>
              Esta Política de Privacidade descreve como o Zetta CRM ("nós", "a plataforma") coleta,
              usa e protege as informações dos usuários ("você") ao utilizar nossa extensão de Chrome
              e o painel web associado. Ao usar o Zetta CRM, você concorda com as práticas descritas
              neste documento.
            </p>
            <p>
              O Zetta CRM é uma ferramenta de gestão de assinantes e campanhas de mensagens que opera
              sobre a sua própria sessão do WhatsApp Web. Não somos afiliados ao WhatsApp nem à Meta.
            </p>
          </Section>

          <Section id="dados-coletados" titulo="2. Dados que coletamos">
            <p>Coletamos os seguintes dados quando você se cadastra e usa a plataforma:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Dados de cadastro:</strong> nome, e-mail e número de WhatsApp informados no formulário de instalação.</li>
              <li><strong>Dados de assinantes:</strong> nomes, telefones, status e valores importados da sua planilha (App Barber, Cash Barber, Frizzar ou planilha própria).</li>
              <li><strong>Token de pareamento:</strong> identificador que vincula a extensão instalada à sua barbearia.</li>
              <li><strong>Dados de uso:</strong> campanhas criadas, mensagens enviadas e métricas de uso para controle dos limites do plano.</li>
            </ul>
          </Section>

          <Section id="uso-dados" titulo="3. Como usamos seus dados">
            <p>Utilizamos seus dados exclusivamente para:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Vincular a extensão à sua conta e isolar seus dados por barbearia.</li>
              <li>Organizar seus assinantes em colunas (ativos, a vencer, inadimplentes etc.).</li>
              <li>Gerar a fila de envio das campanhas e controlar o ritmo de disparo.</li>
              <li>Calcular limites de uso do plano gratuito e do Premium.</li>
              <li>Processar pagamentos via Stripe e gerenciar sua assinatura.</li>
            </ul>
            <p>Não vendemos seus dados a terceiros nem os usamos para fins de marketing sem o seu consentimento.</p>
          </Section>

          <Section id="compartilhamento" titulo="4. Compartilhamento de dados">
            <p>Compartilhamos dados apenas com provedores essenciais ao funcionamento da plataforma:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><strong>Supabase:</strong> armazenamento seguro do banco de dados, com isolamento por barbearia (RLS).</li>
              <li><strong>Stripe:</strong> processamento de pagamentos da assinatura Premium.</li>
              <li><strong>Provedor de envio (quando aplicável):</strong> API oficial da Meta Cloud ou provedor não oficial, conforme a configuração da sua barbearia.</li>
            </ul>
            <p>Cada provedor processa apenas o mínimo necessário para a função que executa.</p>
          </Section>

          <Section id="armazenamento" titulo="5. Armazenamento e segurança">
            <p>
              Seus dados ficam armazenados em provedores em nuvem com criptografia em trânsito (TLS) e
              em repouso. O acesso entre barbearias é bloqueado por políticas de segurança a nível de
              linha (Row Level Security), garantindo que ninguém além de você acesse a sua base.
            </p>
            <p>
              O token de pareamento da extensão pode ser revogado a qualquer momento, invalidando o
              acesso imediato da extensão aos seus dados.
            </p>
          </Section>

          <Section id="direitos" titulo="6. Seus direitos (LGPD)">
            <p>
              Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar a
              qualquer momento:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Acesso aos dados que temos sobre você.</li>
              <li>Correção de dados incorretos ou desatualizados.</li>
              <li>Exclusão dos seus dados ("direito ao esquecimento").</li>
              <li>Portabilidade dos seus dados.</li>
              <li>Revogação do consentimento.</li>
            </ul>
            <p>
              Para exercer qualquer desses direitos, envie um e-mail para o contato indicado na
              seção 12.
            </p>
          </Section>

          <Section id="cookies" titulo="7. Cookies e armazenamento local">
            <p>
              A extensão utiliza armazenamento local do navegador para guardar o token de pareamento
              e preferências de interface. O painel web pode utilizar cookies essenciais para
              manter sua sessão ativa. Não utilizamos cookies de rastreamento de terceiros para
              publicidade.
            </p>
          </Section>

          <Section id="termos" titulo="8. Termos de Uso">
            <p>
              Ao instalar e usar o Zetta CRM, você concorda com estes Termos. A plataforma é
              fornecida "como está", sem garantias de disponibilidade ininterrupta ou ausência total
              de erros.
            </p>
            <p>
              O Zetta CRM é uma ferramenta de gestão e automação de envios. É de sua
              responsabilidade utilizar a plataforma em conformidade com os termos de serviço do
              WhatsApp e com a legislação aplicável, incluindo regras de envio de mensagens em massa
              e consentimento de contatos.
            </p>
          </Section>

          <Section id="uso-aceitavel" titulo="9. Uso aceitável">
            <p>Você concorda em NÃO utilizar a plataforma para:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Enviar mensagens não solicitadas (spam) a contatos que não autorizaram o recebimento.</li>
              <li>Praticar atividades fraudulentas, ilegais ou que violem direitos de terceiros.</li>
              <li>Tentar acessar dados de outras barbearias ou contornar as medidas de isolamento.</li>
              <li>Engenharia reversa, descompilar ou redistribuir o código da extensão.</li>
            </ul>
            <p>
              O descumprimento pode resultar em suspensão imediata da conta, sem reembolso, e no
              bloqueio do token de pareamento.
            </p>
          </Section>

          <Section id="pagamentos" titulo="10. Planos e pagamentos">
            <p>
              O Zetta CRM oferece um plano gratuito com limites de uso (assinalantes e mensagens) e
              um plano Premium (R$ 97/mês) com uso ampliado. A cobrança do Premium é processada pela
              Stripe e é recorrente mensalmente, sem fidelidade — você pode cancelar quando quiser.
            </p>
            <p>
              O cancelamento interrompe a renovação; o acesso ao Premium permanece até o fim do
              período já pago. Não há reembolso de períodos parciais.
            </p>
          </Section>

          <Section id="limitacao" titulo="11. Limitação de responsabilidade">
            <p>
              O Zetta CRM não se responsabiliza por bloqueios, suspensões ou banimentos de números
              de WhatsApp decorrentes do uso da plataforma, especialmente quando o envio ocorre por
              provedores não oficiais ou em desacordo com os termos do WhatsApp. A escolha do
              provedor e o volume de envios são de sua responsabilidade.
            </p>
            <p>
              Em nenhuma hipótese a responsabilidade da plataforma excederá o valor pago por você
              nos 12 meses anteriores ao evento.
            </p>
          </Section>

          <Section id="contato" titulo="12. Contato">
            <p>
              Para dúvidas sobre esta política, solicitações de dados ou questões de privacidade,
              entre em contato pelo e-mail cadastrado na sua conta ou pelo formulário de instalação
              na página inicial.
            </p>
          </Section>
        </div>

        <div className="mt-16 rounded-2xl border border-white/10 bg-neutral-900 p-5 text-center">
          <p className="text-sm text-neutral-300">
            Ainda tem dúvidas sobre como o Zetta CRM funciona?
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex rounded-lg bg-yellow-400 px-5 py-2.5 text-xs font-bold text-neutral-950 hover:bg-yellow-300"
          >
            VOLTAR PARA A PÁGINA INICIAL
          </Link>
        </div>
      </div>

      <footer className="border-t border-white/10 py-8 text-center text-xs text-neutral-500">
        Zetta CRM · CRM de assinaturas para barbearias
      </footer>
    </div>
  );
}
