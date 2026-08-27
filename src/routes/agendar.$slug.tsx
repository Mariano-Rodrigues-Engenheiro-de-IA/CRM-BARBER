// Página pública de agendamento online (mobile + desktop), em etapas.
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
  shop_logo: string | null;
  slot_duration_minutes: number;
  business_hours: Record<string, { closed: boolean; open?: string; close?: string }>;
  professionals: Professional[];
  services: Service[];
  professional_services: { professional_id: string; service_id: string }[];
  hide_professional_selection: boolean;
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

const STEPS_WITH_PRO = ["Serviço", "Profissional", "Data e horário", "Seus dados"];
const STEPS_NO_PRO = ["Serviço", "Data e horário", "Seus dados"];

function BookingPage() {
  const { slug } = Route.useParams();
  const tz = typeof window !== "undefined" ? new Date().getTimezoneOffset() : 0;
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
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
    fetch(`/api/public/booking/${slug}?date=${date}&tz=${tz}`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, date]);

  const service = config?.services.find((s) => s.id === serviceId) ?? null;
  const hideProStep = !!config?.hide_professional_selection;
  const STEPS = hideProStep ? STEPS_NO_PRO : STEPS_WITH_PRO;
  const stepDateTime = hideProStep ? 1 : 2;
  const stepFinal = hideProStep ? 2 : 3;

  const linkedProfessionals = useMemo(() => {
    if (!config || !serviceId) return config?.professionals ?? [];
    const linkedIds = config.professional_services.filter((l) => l.service_id === serviceId).map((l) => l.professional_id);
    if (!linkedIds.length) return config.professionals; // serviço sem vínculo configurado: mantém todo mundo elegível
    return config.professionals.filter((p) => linkedIds.includes(p.id));
  }, [config, serviceId]);

  const slots = useMemo(() => {
    if (!config) return [] as string[];
    const dow = new Date(`${date}T00:00:00`).getDay();
    const hours = config.business_hours?.[String(dow)];
    if (!hours || hours.closed || !hours.open || !hours.close) return [];
    const duration = service?.duration_minutes ?? config.slot_duration_minutes;
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const candidateIds = linkedProfessionals.map((p) => p.id);
    const list: string[] = [];
    for (let m = toMin(hours.open); m + duration <= toMin(hours.close); m += config.slot_duration_minutes) {
      const start = dayStart + m * 60000;
      const end = start + duration * 60000;
      if (start < Date.now()) continue;
      const overlaps = (b: Busy) => new Date(b.start).getTime() < end && new Date(b.end).getTime() > start;
      let busy: boolean;
      if (professionalId) {
        // Profissional específico escolhido: só olha os bloqueios dele.
        busy = config.busy.some((b) => (b.professional_id === null || b.professional_id === professionalId) && overlaps(b));
      } else if (hideProStep && candidateIds.length) {
        // Sem seleção de profissional: só fica indisponível se TODOS os
        // vinculados ao serviço estiverem ocupados nesse horário.
        busy = candidateIds.every((pid) => config.busy.some((b) => (b.professional_id === null || b.professional_id === pid) && overlaps(b)));
      } else {
        busy = config.busy.some((b) => b.professional_id === null && overlaps(b));
      }
      if (!busy) list.push(toTime(m));
    }
    return list;
  }, [config, date, professionalId, service, hideProStep, linkedProfessionals]);

  async function submit() {
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 8) {
      toast.error("Preencha nome e telefone");
      return;
    }
    setSending(true);
    try {
      const r = await fetch(`/api/public/booking/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, phone, professional_id: professionalId, service_id: serviceId, date, time, notes, tz_offset: tz }),
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
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-brand/30 bg-brand/5 p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand text-2xl text-white">✓</div>
          <h1 className="mt-4 text-xl font-semibold text-brand">Agendamento confirmado</h1>
          <p className="mt-1 text-sm text-brand/80">Obrigado pela preferência!</p>
        </div>
      </main>
    );
  }

  const canGoNext =
    (step === 0 && !!serviceId) || (!hideProStep && step === 1) || (step === stepDateTime && !!time) || step === stepFinal;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        {config.shop_logo ? (
          <img src={config.shop_logo} alt={`Logo de ${config.shop_name}`} className="h-12 w-12 rounded-xl object-cover" />
        ) : null}
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{config.shop_name}</h1>
          <p className="text-sm text-neutral-500">
            Etapa {step + 1} de {STEPS.length} · {STEPS[step]}
          </p>
        </div>
      </header>

      <div className="mb-4 flex gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s} className={"h-1.5 flex-1 rounded-full " + (i <= step ? "bg-brand" : "bg-neutral-200")} />
        ))}
      </div>

      <section className="space-y-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        {step === 0 && (
          <div className="space-y-2">
            <Label>Escolha o serviço</Label>
            <div className="grid gap-2">
              {config.services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setServiceId(s.id);
                    setStep(1);
                  }}
                  className={
                    "rounded-xl border px-3 py-3 text-left text-sm transition " +
                    (serviceId === s.id ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/50")
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
        )}

        {step === 1 && !hideProStep && (
          <div className="space-y-2">
            <Label>Escolha o profissional</Label>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setProfessionalId(null);
                  setStep(2);
                }}
                className={
                  "rounded-xl border px-3 py-3 text-left text-sm transition " +
                  (professionalId === null ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/50")
                }
              >
                Sem preferência
              </button>
              {linkedProfessionals.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProfessionalId(p.id);
                    setStep(2);
                  }}
                  className={
                    "flex items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition " +
                    (professionalId === p.id ? "border-brand bg-brand/5" : "border-neutral-200 hover:border-brand/50")
                  }
                >
                  {p.avatar_url ? (
                    <img src={p.avatar_url} alt={`Foto de ${p.name}`} className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="h-9 w-9 rounded-full" style={{ backgroundColor: p.color }} />
                  )}
                  <span>
                    <span className="block font-medium text-neutral-800">{p.name}</span>
                    {p.bio && <span className="text-xs text-neutral-500">{p.bio}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === stepDateTime && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={date} min={ymd(new Date())} onChange={(e) => setDate(e.target.value)} className="w-48" />
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
                        "rounded-lg border px-3 py-1.5 text-sm transition " +
                        (time === t ? "border-brand bg-brand text-white" : "border-neutral-300 text-neutral-700 hover:border-brand")
                      }
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {step === stepFinal && (
          <div className="space-y-3">
            <div className="rounded-xl bg-neutral-50 p-3 text-sm text-neutral-600">
              {service?.name} · {new Date(`${date}T${time ?? "00:00"}:00`).toLocaleString("pt-BR", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="space-y-1.5">
              <Label>Seu nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {step > 0 && (
            <Button variant="outline" className="flex-1" onClick={() => setStep((s) => s - 1)}>
              Voltar
            </Button>
          )}
          {step < stepFinal ? (
            <Button className="flex-1 bg-brand text-white hover:bg-brand-strong" disabled={!canGoNext} onClick={() => setStep((s) => s + 1)}>
              Continuar
            </Button>
          ) : (
            <Button className="flex-1 bg-brand text-white hover:bg-brand-strong" onClick={submit} disabled={sending}>
              {sending ? "Enviando..." : "Confirmar agendamento"}
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
