import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/email-confirmado")({
  head: () => ({
    meta: [{ title: "E-mail confirmado | CRM Zaylo" }, { name: "robots", content: "noindex" }],
  }),
  component: EmailConfirmado,
});

// Destino do link de confirmacao de e-mail (cadastro no painel). A pessoa
// nao chega logada aqui: so precisa voltar pro WhatsApp Web e abrir o CRM.
function EmailConfirmado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">E-mail confirmado</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Tudo certo. Volte para o WhatsApp Web, abra o CRM pela barra lateral e clique em Entrar com o seu e-mail e senha.
        </p>
      </div>
    </div>
  );
}
