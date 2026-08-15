// Página pública de agendamento online (mobile + desktop).
// Acessada pelo link que a barbearia compartilha: /agendar/<slug>

import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export const Route = createFileRoute("/agendar/$slug")({
  component: BookingPage,
  head: () => ({
    meta: [
      { title: "Agendar horário | Zaylo" },
      { name: "description", content: "Escolha o profissional, o serviço e o horário para agendar seu atendimento online em poucos segundos." },
      { property: "og:title", content: "Agendar horário | Zaylo" },
      { property: "og:description", content: "Agende seu horário na barbearia direto pelo celular ou computador." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Professional = { id: string; name: string; color: string; avatar_url: string | null; bio: string | null };
type Service = { id: string; name: string; duration_minutes: number; price: number | null };
type Busy = { professional_id: string | null; start: string; end: string };
type Config = {
  shop_name: string;
  slot_duration_minutes: number;
  business_hours: Record<string, { closed: boolean; open?: string; close?: string }>;
  professionals: Professional[];
  services: Service[];
  busy: Busy[];
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function toTime(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function BookingPage() {
  const { slug } = Route.useParams();
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => ymd(new Date()));
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setTime(null);
    fetch(`/api/public/booking/${slug}?date=${date}`)
      .then((r) => r.json())
      .then((r) => {
        if (r?.ok) {
          setConfig(r);
          setError(null);
        } else {
          setError(r?.error || "Agendamento indisponível");
        }
      })
      .catch(() => setError("Não foi possível carregar a agenda"));
  }, [slug, date]);

  const service = config?.services.find((s) => s.id === serviceId) ?? null;

  const slots = useMemo(() => {
    if (!config) return [] as string[];
    const dow = new Date(`${date}T00:00:00`).getDay();
    const hours = config.business_hours?.[String(dow)];
    if (!hours || hours.closed || !hours.open || !hours.close) return [];
    const duration = service?.duration_minutes ?? config.slot_duration_minutes;
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const list: string[] = [];
    for (let m = toMin(hours.open); m + duration <= toMin(hours.close); m += config.slot_duration_minutes) {
      const start = dayStart + m * 60000;
      const end = start + duration * 60000;
      if (start < Date.now()) continue;
      const busy = config.busy.some((b) => {
        const sameColumn = b.professional_id === null || b.professional_id === professionalId;
        if (!sameColumn) return false;
        return new Date(b.start).getTime() < end && new Date(b.end).getTime() > start;
      });
      if (!busy) list.push(toTime(m));
    }
    return list;
  }, [config, date, professionalId, service]);

  async function submit() {
    if (!serviceId || !time || name.trim().length < 2 || phone.replace(/\D/g, "").length < 8) {
      toast.error("Preencha nome, telefone, serviço e horário");
      return;
    }
    setSending(true);
    try {
      const r = await fetch(`/api/public/booking/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, professional_id: professionalId, service_id: serviceId, date, time, notes }),
      }).then((x) => x.json());
      if (!r?.ok) throw new Error(r?.error || "Erro ao agendar");
      setDone(true);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao agendar");
    } finally {
      setSending(false);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <p className="text-sm text-neutral-500">{error}</p>
      </main>
    );
  }
  if (!config) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-neutral-500">Carregando agenda...</p>
      </main>
    );
  }
  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-neutral-900">Agendamento enviado!</h1>
          <p className="mt-2 text-sm text-neutral-500">
            {config.shop_name} recebeu seu pedido para {new Date(`${date}T${time}:00`).toLocaleString("pt-BR")}. Você receberá a
            confirmação pelo WhatsApp.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900">{config.shop_name}</h1>
        <p className="text-sm text-neutral-500">Escolha profissional, serviço e horário.</p>
      </header>

      <section className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="space-y-1.5">
          <Label>Data</Label>
          <Input type="date" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} className="w-48" />
        </div>

        {config.professionals.length > 0 && (
          <div className="space-y-1.5">
            <Label>Profissional</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setProfessionalId(null)}
                className={
                  "rounded-full border px-3 py-1.5 text-sm " +
                  (professionalId === null ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600")
                }
              >
                Sem preferência
              </button>
              {config.professionals.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProfessionalId(p.id)}
                  className={
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm " +
                    (professionalId === p.id ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600")
                  }
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={`Foto de ${p.name}`} className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  )}
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>Serviço</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {config.services.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setServiceId(s.id)}
                className={
                  "rounded-xl border px-3 py-2 text-left text-sm " +
                  (serviceId === s.id ? "border-neutral-900 bg-neutral-50" : "border-neutral-200")
                }
              >
                <span className="block font-medium text-neutral-800">{s.name}</span>
                <span className="text-xs text-neutral-500">
                  {s.duration_minutes} min{s.price != null ? ` · R$ ${Number(s.price).toFixed(2)}` : ""}
                </span>
              </button>
            ))}
            {config.services.length === 0 && <p className="text-sm text-neutral-500">Nenhum serviço cadastrado.</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Horário</Label>
          {slots.length === 0 ? (
            <p className="text-sm text-neutral-500">Sem horários disponíveis nesse dia.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {slots.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTime(t)}
                  className={
                    "rounded-lg border px-3 py-1.5 text-sm " +
                    (time === t ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-700")
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Seu nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="space-y-1.5">
            <Label>WhatsApp</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Observação (opcional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <Button className="w-full" onClick={submit} disabled={sending}>
          {sending ? "Enviando..." : "Confirmar agendamento"}
        </Button>
      </section>
    </main>
  );
}
