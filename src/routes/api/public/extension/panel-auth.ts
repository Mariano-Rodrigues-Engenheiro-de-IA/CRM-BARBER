// /api/public/extension/panel-auth
//
// Login e senha no painel (liberado por barbearia via barbershops.login_required).
// Todo cliente ja tem a barbearia (e o e-mail) desde o checkout, entao a
// pessoa nao "cria conta": so DEFINE A SENHA do e-mail que ja e dela. O token
// da extensao (que prova o controle do WhatsApp da barbearia) autoriza isso.
//
// GET  -> { ok, login_required, has_owner, owner_email }
// POST { action: "set_password", password, email? }
//        cria o login do e-mail da barbearia ja confirmado (sem e-mail de
//        confirmacao) e liga a barbearia. So funciona se ela ainda nao tem dono.
// POST { action: "verify", access_token }
//        confere que a sessao do login e a do dono dessa barbearia. Se a
//        barbearia ainda nao tem dono, o login so vale se o e-mail dele for o
//        e-mail cadastrado da barbearia (caso de quem ja tinha login com ele).

import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, preflight } from "@/lib/extension-cors";
import { authenticateExtension } from "@/lib/extension-auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
          supabaseAdmin
            .from("barbershops")
            .select("login_required, owner_email")
            .eq("id", shopId)
            .maybeSingle(),
          supabaseAdmin.from("barbershop_owners").select("user_id").eq("barbershop_id", shopId).maybeSingle(),
        ]);
        return jsonResponse(request, {
          ok: true,
          login_required: Boolean(shop?.login_required),
          has_owner: Boolean(owner),
          owner_email: shop?.owner_email ?? null,
        });
      },

      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const auth = await authenticateExtension(request, supabaseAdmin);
        if (!auth.ok) {
          return jsonResponse(request, { ok: false, error: auth.error }, { status: auth.status });
        }
        const shopId = auth.token.barbershop_id;

        let body: { action?: unknown; access_token?: unknown; password?: unknown; email?: unknown } = {};
        try {
          body = await request.json();
        } catch {
          /* corpo invalido cai nos erros abaixo */
        }

        const { data: shop } = await supabaseAdmin
          .from("barbershops")
          .select("owner_email")
          .eq("id", shopId)
          .maybeSingle();
        const { data: owner } = await supabaseAdmin
          .from("barbershop_owners")
          .select("user_id")
          .eq("barbershop_id", shopId)
          .maybeSingle();

        // ---------- Definir a senha (primeira vez) ----------
        if (body.action === "set_password") {
          if (owner) {
            return jsonResponse(
              request,
              { ok: false, code: "has_owner", error: "Essa barbearia já tem senha definida. Use Entrar." },
              { status: 409 },
            );
          }
          const password = typeof body.password === "string" ? body.password : "";
          if (password.length < 8) {
            return jsonResponse(request, { ok: false, error: "A senha precisa ter pelo menos 8 caracteres." }, { status: 400 });
          }
          const knownEmail = (shop?.owner_email ?? "").trim().toLowerCase();
          const typedEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
          // O e-mail da barbearia manda; so aceita o digitado se a barbearia
          // ainda nao tem e-mail cadastrado.
          const email = knownEmail || typedEmail;
          if (!EMAIL_RE.test(email)) {
            return jsonResponse(request, { ok: false, error: "Informe um e-mail válido." }, { status: 400 });
          }

          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
          });
          if (createErr || !created?.user) {
            const already =
              (createErr as { code?: string } | null)?.code === "email_exists" ||
              /already.*registered|already been registered|email_exists/i.test(createErr?.message ?? "");
            if (already) {
              return jsonResponse(
                request,
                { ok: false, code: "email_exists", error: "Esse e-mail já tem um login. Digite a senha dele pra entrar." },
                { status: 409 },
              );
            }
            return jsonResponse(request, { ok: false, error: createErr?.message || "Não foi possível criar o login." }, { status: 500 });
          }

          const { error: insErr } = await supabaseAdmin
            .from("barbershop_owners")
            .insert({ user_id: created.user.id, barbershop_id: shopId });
          if (insErr) {
            // Alguem definiu antes (corrida): desfaz o login recem criado.
            await supabaseAdmin.auth.admin.deleteUser(created.user.id).catch(() => null);
            return jsonResponse(
              request,
              { ok: false, code: "has_owner", error: "Essa barbearia acabou de ter a senha definida. Use Entrar." },
              { status: 409 },
            );
          }
          if (!knownEmail) {
            await supabaseAdmin.from("barbershops").update({ owner_email: email }).eq("id", shopId);
          }
          return jsonResponse(request, { ok: true, email });
        }

        // ---------- Conferir a sessao do login ----------
        const accessToken = typeof body.access_token === "string" ? body.access_token : "";
        if (!accessToken) {
          return jsonResponse(request, { ok: false, error: "Faça login primeiro." }, { status: 401 });
        }
        const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
        const user = userData?.user;
        if (userErr || !user) {
          return jsonResponse(request, { ok: false, error: "Sessão inválida. Entre de novo." }, { status: 401 });
        }

        if (owner) {
          if (owner.user_id === user.id) return jsonResponse(request, { ok: true });
          return jsonResponse(
            request,
            { ok: false, error: "Essa barbearia já tem um login de dono. Entre com o e-mail dela." },
            { status: 403 },
          );
        }

        // Sem dono ainda: so vira dono quem entrou com o e-mail cadastrado da
        // barbearia (e com e-mail confirmado).
        const knownEmail = (shop?.owner_email ?? "").trim().toLowerCase();
        if (!knownEmail || (user.email ?? "").toLowerCase() !== knownEmail || !user.email_confirmed_at) {
          return jsonResponse(
            request,
            { ok: false, error: "Entre com o e-mail cadastrado nessa barbearia." },
            { status: 403 },
          );
        }
        const { error: insErr } = await supabaseAdmin
          .from("barbershop_owners")
          .insert({ user_id: user.id, barbershop_id: shopId });
        if (insErr) {
          return jsonResponse(
            request,
            { ok: false, error: "Esse login já está ligado a outra barbearia." },
            { status: 409 },
          );
        }
        return jsonResponse(request, { ok: true, claimed: true });
      },
    },
  },
});
