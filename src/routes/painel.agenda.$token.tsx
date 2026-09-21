// Rota dedicada para o link "Minha agenda" (Configurações > Gerais),
// pensada especificamente pra ser salva como atalho na tela de início
// do celular.
//
// Histórico de correções reais (19/09), em ordem:
// 1. Token como parâmetro de query (?token=xxx) — sumia da URL antes
//    de confirmar "Adicionar à Tela de Início" em teste real.
// 2. Movido pro CAMINHO da URL (/painel/agenda/TOKEN) — resolveu o
//    problema de o token sumir, confirmado em teste real (a URL final
//    chegava corretamente em /painel?section=agenda&mobile=agenda).
//    Mas a implementação usava window.location.replace() logo após
//    localStorage.setItem() — um RECARREGAMENTO COMPLETO da página
//    logo em seguida a uma escrita no armazenamento local, o que pode
//    ter uma corrida real em alguns navegadores/contextos (a escrita
//    "termina" do ponto de vista do JavaScript, mas a persistência em
//    disco pode não ter sido garantida antes da página ser destruída
//    e recarregada do zero). Resultado real: tela branca permanente.
// 3. ATUAL: troca window.location.replace() (recarga completa) por
//    redirect() do próprio router, dentro de beforeLoad — isso faz uma
//    navegação client-side (SPA), sem NUNCA destruir/recarregar a
//    página. O token salvo no localStorage continua disponível o
//    tempo todo na MESMA sessão de JavaScript, sem depender de
//    nenhuma garantia de persistência entre um "antes" e um "depois"
//    de reload — elimina esse tipo de corrida por completo.

import { createFileRoute, redirect } from "@tanstack/react-router";

const TOKEN_KEY = "crm_ext_token_v1";

export const Route = createFileRoute("/painel/agenda/$token")({
  beforeLoad: ({ params }) => {
    if (typeof window !== "undefined" && params.token) {
      localStorage.setItem(TOKEN_KEY, params.token);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw redirect({ to: "/painel", search: { section: "agenda", mobile: "agenda" } as any });
  },
});
