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
});

function normalizePhone(input: string): string {
  return input.replace(/\D+/g, "");
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

        // Look up an existing barbershop by phone or email so refills of the form
        // don't create duplicates.
        const { data: existingByPhone } = await supabaseAdmin
          .from("barbershops")
          .select("id")
          .eq("owner_phone", phone)
          .maybeSingle();
        if (existingByPhone) {
          return new Response(JSON.stringify({ ok: true, barbershop_id: existingByPhone.id }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...cors },
          });
        }
        const { data: existingByEmail } = await supabaseAdmin
          .from("barbershops")
          .select("id, owner_phone")
          .eq("owner_email", email)
          .maybeSingle();
        if (existingByEmail) {
          if (existingByEmail.owner_phone !== phone) {
            const { error: updateError } = await supabaseAdmin
              .from("barbershops")
              .update({
                name,
                owner_name: name,
                owner_phone: phone,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingByEmail.id);

            if (updateError) {
              return new Response(
                JSON.stringify({ ok: false, error: "Falha ao atualizar cadastro" }),
                { status: 500, headers: { "Content-Type": "application/json", ...cors } },
              );
            }
          }

          return new Response(JSON.stringify({ ok: true, barbershop_id: existingByEmail.id }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...cors },
          });
        }

        const { data: inserted, error: insertError } = await supabaseAdmin
          .from("barbershops")
          .insert({
            name,
            owner_name: name,
            owner_email: email,
            owner_phone: phone,
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
