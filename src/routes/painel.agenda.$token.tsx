// Rota dedicada para o link "Minha agenda" (Configurações > Gerais),
// pensada especificamente pra ser salva como atalho na tela de início
// do celular.
//
// ⚠️ Corrigido (19/09, sexta tentativa real): a versão anterior desse
// link colocava o token como PARÂMETRO DE QUERY (?token=xxx). Mesmo
// preservando ele explicitamente no código (sem limpar via
// history.replaceState), o usuário confirmou em teste real que o
// token ainda sumia da URL antes mesmo de confirmar "Adicionar à Tela
// de Início" — já não aparecia nem na prévia do menu de compartilhar.
// Suspeita: algum comportamento do navegador/SO tratando o parâmetro
// de query como algo a "limpar" (heurísticas de privacidade que
// normalizam/removem parâmetros de URL parecidos com tokens de
// rastreamento).
//
// Esta rota resolve isso mudando ONDE o token mora na URL: em vez de
// um parâmetro depois de "?", ele agora é parte do CAMINHO da URL
// (/painel/agenda/TOKEN) — navegadores não normalizam nem limpam
// segmentos de caminho, só fazem isso com query strings. Ao carregar,
// esta rota salva o token no mesmo local (localStorage) que o painel
// já usa, e navega pra tela normal da agenda — sem o token aparecer
// como query string em nenhum momento. Se o atalho salvo é sempre
// esta URL fixa (com o token no caminho), toda vez que for aberto o
// token é regravado no armazenamento local automaticamente, mesmo que
// esse armazenamento tenha sido isolado/limpo entre sessões.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

const TOKEN_KEY = "crm_ext_token_v1";

export const Route = createFileRoute("/painel/agenda/$token")({
  component: MobileAgendaShortcut,
  head: () => ({
    meta: [{ title: "Minha agenda | Zaylo" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function MobileAgendaShortcut() {
  const { token } = Route.useParams();

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    window.location.replace("/painel?section=agenda&mobile=agenda");
  }, [token]);

  return null;
}
