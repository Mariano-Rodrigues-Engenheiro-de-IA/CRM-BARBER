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
  // Diferença de fuso do navegador do cliente (Date#getTimezoneOffset).
  tz_offset: z.number().int().min(-840).max(840).optional(),
});

/** Converte data+hora locais do cliente em instante UTC real.
 * Sem isso o servidor (UTC) grava o horário 3h à frente e o agendamento
 * "some" da agenda da barbearia. */
function localToUtc(date: string, time: string, tzOffsetMinutes: number) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) + tzOffsetMinutes * 60000);
}

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
    .select(
      "barbershop_id, slot_duration_minutes, business_hours, online_booking_enabled, public_slug, hide_professional_selection, distribution_mode",
    )
    .eq("public_slug", slug)
    .maybeSingle();
  if (!settings || !settings.online_booking_enabled) return { supabaseAdmin, settings: null };
  return { supabaseAdmin, settings };
}

/** Profissionais vinculados a um serviço. Serviço sem nenhum vínculo
 * configurado ainda cai no comportamento antigo (todo mundo elegível),
 * pra não travar o agendamento de barbearias que não configuraram isso. */
function linkedOrAll(serviceId: string, links: { professional_id: string; service_id: string }[], allIds: string[]) {
  const linked = links.filter((l) => l.service_id === serviceId).map((l) => l.professional_id);
  return linked.length ? linked : allIds;
}

/** Quantos horários livres esse profissional tem no dia (pro critério de
 * "maior disponibilidade") — mesma lógica de enumeração de slots usada no
 * cliente, só que rodando aqui no servidor pra cada candidato. */
function countFreeSlots(
  professionalId: string,
  hours: { closed: boolean; open?: string; close?: string } | undefined,
  slotDuration: number,
  serviceDuration: number,
  dayStartMs: number,
  busy: { professional_id: string | null; start: string; end: string }[],
) {
  if (!hours || hours.closed || !hours.open || !hours.close) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  let count = 0;
  for (let m = toMin(hours.open); m + serviceDuration <= toMin(hours.close); m += slotDuration) {
    const start = dayStartMs + m * 60000;
    const end = start + serviceDuration * 60000;
    if (start < Date.now()) continue;
    const conflict = busy.some((b) => {
      if (b.professional_id !== null && b.professional_id !== professionalId) return false;
      return new Date(b.start).getTime() < end && new Date(b.end).getTime() > start;
    });
    if (!conflict) count += 1;
  }
  return count;
}

export const Route = createFileRoute("/api/public/booking/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { supabaseAdmin, settings } = await loadShop(params.slug);
        if (!settings) return json({ ok: false, error: "Agendamento online indisponível" }, 404);

        const url = new URL(request.url);
        const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
        const tz = Number(url.searchParams.get("tz") ?? "0") || 0;
        const from = localToUtc(date, "00:00", tz);
        const to = new Date(localToUtc(date, "23:59", tz).getTime() + 59_000);

        const [shop, professionals, services, appointments, blocks, links] = await Promise.all([
          supabaseAdmin.from("barbershops").select("name, logo_url").eq("id", settings.barbershop_id).maybeSingle(),
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
          supabaseAdmin.from("professional_services").select("professional_id, service_id"),
        ]);

        return json({
          ok: true,
          shop_name: shop.data?.name ?? "Barbearia",
          shop_logo: shop.data?.logo_url ?? null,
          slot_duration_minutes: settings.slot_duration_minutes,
          business_hours: settings.business_hours,
          hide_professional_selection: settings.hide_professional_selection ?? false,
          professionals: professionals.data ?? [],
          services: services.data ?? [],
          professional_services: links.data ?? [],
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

        const tz = input.tz_offset ?? 0;
        const start = localToUtc(input.date, input.time, tz);
        const end = new Date(start.getTime() + service.duration_minutes * 60000);
        if (start.getTime() < Date.now()) return json({ ok: false, error: "Horário já passou" }, 400);

        // Conflito: já existe agendamento sobrepondo pro mesmo profissional.
        const dayStartIso = localToUtc(input.date, "00:00", tz).toISOString();
        const dayEndIso = localToUtc(input.date, "23:59", tz).toISOString();
        const [{ data: sameDayAppts }, { data: sameDayBlocks }] = await Promise.all([
          supabaseAdmin
            .from("appointments")
            .select("professional_id, scheduled_at, duration_minutes")
            .eq("barbershop_id", settings.barbershop_id)
            .neq("status", "canceled")
            .gte("scheduled_at", dayStartIso)
            .lte("scheduled_at", dayEndIso),
          supabaseAdmin
            .from("time_blocks")
            .select("professional_id, starts_at, ends_at")
            .eq("barbershop_id", settings.barbershop_id)
            .lte("starts_at", dayEndIso)
            .gte("ends_at", dayStartIso),
        ]);
        const dayBusy = [
          ...(sameDayAppts ?? []).map((a) => ({
            professional_id: a.professional_id,
            start: a.scheduled_at,
            end: new Date(new Date(a.scheduled_at).getTime() + a.duration_minutes * 60000).toISOString(),
          })),
          ...(sameDayBlocks ?? []).map((b) => ({ professional_id: b.professional_id, start: b.starts_at, end: b.ends_at })),
        ];

        let professionalId = input.professional_id ?? null;

        if (!professionalId) {
          // Nenhum profissional escolhido (seleção escondida, ou "sem
          // preferência") — o sistema decide, seguindo o critério
          // configurado nas Configurações do link de agendamento.
          const [{ data: allPros }, { data: links }] = await Promise.all([
            supabaseAdmin
              .from("professionals")
              .select("id, sort_order")
              .eq("barbershop_id", settings.barbershop_id)
              .eq("active", true),
            supabaseAdmin.from("professional_services").select("professional_id, service_id"),
          ]);
          const allIds = (allPros ?? []).map((p) => p.id);
          const candidateIds = linkedOrAll(service.id, links ?? [], allIds);

          // Só quem está livre exatamente nesse horário entra na disputa.
          const availableNow = candidateIds.filter((pid) => {
            return !dayBusy.some((b) => {
              if (b.professional_id !== null && b.professional_id !== pid) return false;
              const s = new Date(b.start).getTime();
              const e = new Date(b.end).getTime();
              return s < end.getTime() && e > start.getTime();
            });
          });
          if (!availableNow.length) {
            return json({ ok: false, error: "Nenhum profissional disponível nesse horário" }, 409);
          }

          const mode = settings.distribution_mode ?? "random";
          if (mode === "random" || availableNow.length === 1) {
            professionalId = availableNow[Math.floor(Math.random() * availableNow.length)];
          } else {
            const dayStartMs = new Date(dayStartIso).getTime();
            const hours = (settings.business_hours as Record<string, { closed: boolean; open?: string; close?: string }>)?.[
              String(new Date(`${input.date}T00:00:00`).getDay())
            ];
            const counts = availableNow.map((pid) => ({
              pid,
              free: countFreeSlots(pid, hours, settings.slot_duration_minutes, service.duration_minutes, dayStartMs, dayBusy),
            }));
            const maxFree = Math.max(...counts.map((c) => c.free));
            let tied = counts.filter((c) => c.free === maxFree).map((c) => c.pid);
            if (mode === "priority" && tied.length > 1) {
              const sortMap = new Map((allPros ?? []).map((p) => [p.id, p.sort_order]));
              const minPriority = Math.min(...tied.map((pid) => sortMap.get(pid) ?? 0));
              tied = tied.filter((pid) => (sortMap.get(pid) ?? 0) === minPriority);
            }
            professionalId = tied[Math.floor(Math.random() * tied.length)];
          }
        } else {
          const conflict = dayBusy.some((b) => {
            if ((b.professional_id ?? null) !== professionalId) return false;
            const s = new Date(b.start).getTime();
            const e = new Date(b.end).getTime();
            return s < end.getTime() && e > start.getTime();
          });
          if (conflict) return json({ ok: false, error: "Esse horário acabou de ser ocupado" }, 409);
        }

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
          professional_id: professionalId,
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
