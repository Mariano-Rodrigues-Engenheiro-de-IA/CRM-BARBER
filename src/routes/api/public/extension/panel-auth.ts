// /api/public/extension/panel-auth
//
// Login e senha no painel (liberado por barbearia via barbershops.login_required).
//
// GET  -> { ok, login_required, has_owner }
//         O painel pergunta isso ao abrir, so com o token da extensao, pra
//         decidir se mostra a tela de cadastro/login antes das abas.
//
// POST -> body { access_token }  (JWT da sessao do Supabase Auth)
//         Confere que esse login pode entrar nessa barbearia:
//          - barbearia sem dono ainda: o login vira o dono (primeira
//            vinculacao). O token da extensao ja prova que a pessoa controla
//            o WhatsApp dessa barbearia, entao so quem tem os dois consegue.
//          - barbearia ja com dono: so o proprio dono passa.
//
// O e-mail precisa estar confirmado pra vincular - senao qualquer um poderia
// se cadastrar com um e-mail que nao e dele.

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

export const Route = createFileRoute("/api/public/extension/panel-auth")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => preflight(request),

      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shopId = auth.token.barbershop_id;
        const [{ data: shop }, { data: owner }] = await Promise.all([
          supabaseAdmin.from("barbershops").select("login_required").eq("id", shopId).maybeSingle(),
          supabaseAdmin.from("barbershop_owners").select("user_id").eq("barbershop_id", shopId).maybeSingle(),
        ]);
        return jsonResponse(request, {
          ok: true,
          login_required: Boolean(shop?.login_required),
          has_owner: Boolean(owner),
        });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shopId = auth.token.barbershop_id;

        let accessToken = "";
        try {
          const body = (await request.json()) as { access_token?: unknown };
          accessToken = typeof body?.access_token === "string" ? body.access_token : "";
        } catch {
          /* corpo invalido cai no erro abaixo */
        }
        if (!accessToken) {
          return jsonResponse(request, { ok: false, error: "Faça login primeiro." }, { status: 401 });
        }

        // Valida o JWT direto no Supabase Auth (nao confia no que veio do navegador).
        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
        const user = userData?.user;
        if (userErr || !user) {
          return jsonResponse(request, { ok: false, error: "Sessão inválida. Entre de novo." }, { status: 401 });
        }
        if (!user.email_confirmed_at) {
          return jsonResponse(
            request,
            { ok: false, error: "Confirme seu e-mail (enviamos um link) e entre de novo." },
            { status: 403 },
          );
        }

        const { data: owner } = await supabaseAdmin
          .from("barbershop_owners")
          .select("user_id")
          .eq("barbershop_id", shopId)
          .maybeSingle();

        if (owner) {
          if (owner.user_id === user.id) return jsonResponse(request, { ok: true, claimed: false });
          return jsonResponse(
            request,
            { ok: false, error: "Essa barbearia já tem um login de dono. Entre com o e-mail dela." },
            { status: 403 },
          );
        }

        // Sem dono ainda: este login vira o dono. As duas UNIQUE (user_id e
        // barbershop_id) seguram corrida e login ja usado em outra barbearia.
        const { error: insErr } = await supabaseAdmin
          .from("barbershop_owners")
          .insert({ user_id: user.id, barbershop_id: shopId });
        if (insErr) {
          const { data: again } = await supabaseAdmin
            .from("barbershop_owners")
            .select("user_id")
            .eq("barbershop_id", shopId)
            .maybeSingle();
          if (again?.user_id === user.id) return jsonResponse(request, { ok: true, claimed: false });
          return jsonResponse(
            request,
            { ok: false, error: "Esse login já está ligado a outra barbearia, ou a barbearia já tem dono." },
            { status: 409 },
          );
        }
        return jsonResponse(request, { ok: true, claimed: true });
      },
    },
  },
});
