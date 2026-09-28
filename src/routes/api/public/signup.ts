// Public signup endpoint — captures name/email/phone from the landing form,
// creates a barbershop row, and returns { ok, barbershop_id }.
//
// No auth required (this is the entry point). Data validated with Zod.
// Phone is normalized to digits-only so it can later be matched against
// the number the extension reads from WhatsApp Web.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const signupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(8).max(20),
  business_type: z.enum(["barbearia", "odontologia", "estetica", "outros"], {
    errorMap: () => ({ message: "Escolha o tipo do seu negócio" }),
  }),
});

function normalizePhone(input: string): string {
  return input.replace(/\D+/g, "");
}

function phoneLookupCandidates(phone: string): string[] {
  const candidates = new Set([phone]);

  const addBrazilVariants = (digits: string) => {
    const national = digits.startsWith("55") ? digits.slice(2) : digits;
    if (national.length < 10 || national.length > 11) return;

    const ddd = national.slice(0, 2);
    const local = national.slice(2);
    const withNinthDigit = local.length === 8 ? `${ddd}9${local}` : national;
    const withoutNinthDigit = local.length === 9 && local.startsWith("9") ? `${ddd}${local.slice(1)}` : national;

    candidates.add(withNinthDigit);
    candidates.add(withoutNinthDigit);
    candidates.add(`55${withNinthDigit}`);
    candidates.add(`55${withoutNinthDigit}`);
  };

  if (phone.startsWith("55") && phone.length > 11) {
    candidates.add(phone.slice(2));
  } else if (phone.length >= 10) {
    candidates.add(`55${phone}`);
  }
  addBrazilVariants(phone);
  return [...candidates];
}

export const Route = createFileRoute("/api/public/signup")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
          });
        }

        const parsed = signupSchema.safeParse(body);
        if (!parsed.success) {
          return new Response(
            JSON.stringify({ ok: false, error: "Dados inválidos", details: parsed.error.flatten() }),
            { status: 400, headers: { "Content-Type": "application/json", ...cors } },
          );
        }

        const phone = normalizePhone(parsed.data.phone);
        if (phone.length < 8) {
          return new Response(JSON.stringify({ ok: false, error: "Telefone inválido" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...cors },
          });
        }
        const email = parsed.data.email.toLowerCase();
        const name = parsed.data.name;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // REGRA: o cadastro NUNCA duplica e NUNCA altera quem ja existe.
        //  - telefone ja cadastrado -> reconhece (ok + already_registered) e nao
        //    muda nada: a pessoa segue usando o mesmo cadastro.
        //  - e-mail ja cadastrado com OUTRO telefone -> recusa (409) e nao muda
        //    nada. Antes esse caso TROCAVA o telefone da barbearia existente, o
        //    que derrubava o pareamento do dono e deixava qualquer um trocar o
        //    numero de outro cliente so sabendo o e-mail dele.
        //  - so cria quando nem o telefone nem o e-mail existem.
        // Se a checagem falhar, recusa em vez de arriscar criar duplicado.
        const jsonHeaders = { "Content-Type": "application/json", ...cors };

        const { data: phoneMatches, error: phoneErr } = await supabaseAdmin
          .from("barbershops")
          .select("id")
          .in("owner_phone", phoneLookupCandidates(phone))
          .limit(1);
        if (phoneErr) {
          return new Response(JSON.stringify({ ok: false, error: "Falha ao verificar cadastro" }), {
            status: 500,
            headers: jsonHeaders,
          });
        }
        if (phoneMatches && phoneMatches.length > 0) {
          return new Response(
            JSON.stringify({ ok: true, already_registered: true, barbershop_id: phoneMatches[0].id }),
            { status: 200, headers: jsonHeaders },
          );
        }

        // ilike sem curinga = compara sem diferenciar maiusculas (ha e-mails
        // antigos gravados com maiuscula). % e _ do e-mail sao escapados.
        const emailPattern = email.replace(/[\\%_]/g, "\\$&");
        const { data: emailMatches, error: emailErr } = await supabaseAdmin
          .from("barbershops")
          .select("id")
          .ilike("owner_email", emailPattern)
          .limit(1);
        if (emailErr) {
          return new Response(JSON.stringify({ ok: false, error: "Falha ao verificar cadastro" }), {
            status: 500,
            headers: jsonHeaders,
          });
        }
        if (emailMatches && emailMatches.length > 0) {
          return new Response(
            JSON.stringify({
              ok: false,
              code: "email_in_use",
              error: "Este e-mail já tem cadastro com outro WhatsApp. Use o mesmo número do primeiro cadastro.",
            }),
            { status: 409, headers: jsonHeaders },
          );
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("barbershops")
          .insert({
            name,
            owner_name: name,
            owner_email: email,
            owner_phone: phone,
            business_type: parsed.data.business_type,
          })
          .select("id")
          .single();

        if (insertError || !inserted) {
          return new Response(
            JSON.stringify({ ok: false, error: "Falha ao cadastrar" }),
            { status: 500, headers: { "Content-Type": "application/json", ...cors } },
          );
        }

        return new Response(JSON.stringify({ ok: true, barbershop_id: inserted.id }), {
          status: 201,
          headers: { "Content-Type": "application/json", ...cors },
        });
      },
    },
  },
});
