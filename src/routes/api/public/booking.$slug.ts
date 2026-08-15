// Agendamento online público (sem login, sem token de extensão).
// GET  /api/public/booking/:slug?date=YYYY-MM-DD -> dados da barbearia + horários livres
// POST /api/public/booking/:slug -> cria o agendamento do cliente
//
// Só responde quando a barbearia habilitou "agendamento online" nas
// configurações da agenda.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bookSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  professional_id: z.string().uuid().optional().nullable(),
  service_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  notes: z.string().trim().max(500).optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadShop(slug: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings } = await supabaseAdmin
    .from("agenda_settings")
    .select("barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!settings || !settings.online_booking_enabled) return { supabaseAdmin, settings: null };
  return { supabaseAdmin, settings };
}

export const Route = createFileRoute("/api/public/booking/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { supabaseAdmin, settings } = await loadShop(params.slug);
        if (!settings) return json({ ok: false, error: "Agendamento online indisponível" }, 404);

        const url = new URL(request.url);
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        const from = new Date(`${date}T00:00:00`);
        const to = new Date(`${date}T23:59:59`);

        const [shop, professionals, services, appointments, blocks] = await Promise.all([
          supabaseAdmin.from("barbershops").select("name").eq("id", settings.barbershop_id).maybeSingle(),
          supabaseAdmin
            .from("professionals")
            .select("id, name, color, avatar_url, bio")
            .eq("barbershop_id", settings.barbershop_id)
            .eq("active", true)
            .order("sort_order", { ascending: true }),
          supabaseAdmin
            .from("services")
            .select("id, name, duration_minutes, price")
            .eq("barbershop_id", settings.barbershop_id)
            .eq("active", true)
            .order("sort_order", { ascending: true }),
          supabaseAdmin
            .from("appointments")
            .select("professional_id, scheduled_at, duration_minutes")
            .eq("barbershop_id", settings.barbershop_id)
            .neq("status", "canceled")
            .gte("scheduled_at", from.toISOString())
            .lte("scheduled_at", to.toISOString()),
          supabaseAdmin
            .from("time_blocks")
            .select("professional_id, starts_at, ends_at")
            .eq("barbershop_id", settings.barbershop_id)
            .lte("starts_at", to.toISOString())
            .gte("ends_at", from.toISOString()),
        ]);

        return json({
          ok: true,
          shop_name: shop.data?.name ?? "Barbearia",
          slot_duration_minutes: settings.slot_duration_minutes,
          business_hours: settings.business_hours,
          professionals: professionals.data ?? [],
          services: services.data ?? [],
          busy: [
            ...(appointments.data ?? []).map((a) => ({
              professional_id: a.professional_id,
              start: a.scheduled_at,
              end: new Date(new Date(a.scheduled_at).getTime() + a.duration_minutes * 60000).toISOString(),
            })),
            ...(blocks.data ?? []).map((b) => ({ professional_id: b.professional_id, start: b.starts_at, end: b.ends_at })),
          ],
        });
      },

      POST: async ({ request, params }) => {
        const { supabaseAdmin, settings } = await loadShop(params.slug);
        if (!settings) return json({ ok: false, error: "Agendamento online indisponível" }, 404);

        const parsed = bookSchema.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
        }
        const input = parsed.data;

        const { data: service } = await supabaseAdmin
          .from("services")
          .select("id, name, duration_minutes")
          .eq("id", input.service_id)
          .eq("barbershop_id", settings.barbershop_id)
          .maybeSingle();
        if (!service) return json({ ok: false, error: "Serviço indisponível" }, 400);

        const start = new Date(`${input.date}T${input.time}:00`);
        const end = new Date(start.getTime() + service.duration_minutes * 60000);
        if (start.getTime() < Date.now()) return json({ ok: false, error: "Horário já passou" }, 400);

        // Conflito: já existe agendamento sobrepondo pro mesmo profissional.
        const { data: sameDay } = await supabaseAdmin
          .from("appointments")
          .select("professional_id, scheduled_at, duration_minutes")
          .eq("barbershop_id", settings.barbershop_id)
          .neq("status", "canceled")
          .gte("scheduled_at", new Date(`${input.date}T00:00:00`).toISOString())
          .lte("scheduled_at", new Date(`${input.date}T23:59:59`).toISOString());
        const conflict = (sameDay ?? []).some((a) => {
          if ((a.professional_id ?? null) !== (input.professional_id ?? null)) return false;
          const s = new Date(a.scheduled_at).getTime();
          return s < end.getTime() && s + a.duration_minutes * 60000 > start.getTime();
        });
        if (conflict) return json({ ok: false, error: "Esse horário acabou de ser ocupado" }, 409);

        const phone = input.phone.replace(/\D/g, "");
        const { data: existingCustomer } = await supabaseAdmin
          .from("customers")
          .select("id")
          .eq("barbershop_id", settings.barbershop_id)
          .eq("phone", phone)
          .maybeSingle();
        let customerId = existingCustomer?.id ?? null;
        if (!customerId) {
          const { data: created } = await supabaseAdmin
            .from("customers")
            .insert({ barbershop_id: settings.barbershop_id, name: input.name, phone, source: "online_booking" })
            .select("id")
            .single();
          customerId = created?.id ?? null;
        }

        const { error } = await supabaseAdmin.from("appointments").insert({
          barbershop_id: settings.barbershop_id,
          customer_id: customerId,
          professional_id: input.professional_id ?? null,
          service_id: service.id,
          title: service.name,
          notes: input.notes ?? null,
          scheduled_at: start.toISOString(),
          duration_minutes: service.duration_minutes,
          status: "scheduled",
        });
        if (error) return json({ ok: false, error: error.message }, 500);

        return json({ ok: true });
      },
    },
  },
});
