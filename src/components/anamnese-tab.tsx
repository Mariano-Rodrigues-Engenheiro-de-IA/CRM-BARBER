// Ficha de anamnese — clínica de estética. Campos baseados no que toda
// clínica de estética costuma perguntar antes de qualquer procedimento:
// condições de saúde, medicamentos, alergias, gestação, tipo de pele e
// histórico. Um registro só por paciente (vai sendo atualizado).

import { useEffect, useState } from "react";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type Anamnese = {
  health_conditions: string[];
  medications: string | null;
  allergies: string[];
  allergies_other: string | null;
  is_pregnant: boolean | null;
  is_breastfeeding: boolean | null;
  skin_type: number | null;
  keloid_tendency: boolean | null;
  procedure_history: string | null;
  notes: string | null;
  filled_at?: string;
};

const HEALTH_CONDITIONS = [
  "Diabetes",
  "Hipertensão",
  "Doença cardíaca",
  "Epilepsia",
  "Asma",
  "Doença autoimune",
  "Distúrbio de coagulação",
  "Doença renal",
  "Doença hepática",
];

const ALLERGY_OPTIONS = ["Látex", "Metais", "Anestésicos", "Antissépticos", "Cosméticos em geral"];

const SKIN_TYPES = [
  { value: 1, label: "I: muito clara, sempre queima" },
  { value: 2, label: "II: clara, queima fácil" },
  { value: 3, label: "III: morena clara, às vezes queima" },
  { value: 4, label: "IV: morena moderada, raramente queima" },
  { value: 5, label: "V: morena escura, quase nunca queima" },
  { value: 6, label: "VI: negra, nunca queima" },
];

const EMPTY: Anamnese = {
  health_conditions: [],
  medications: "",
  allergies: [],
  allergies_other: "",
  is_pregnant: null,
  is_breastfeeding: null,
  skin_type: null,
  keloid_tendency: null,
  procedure_history: "",
  notes: "",
};

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex gap-2">
      {[
        { v: true, label: "Sim" },
        { v: false, label: "Não" },
      ].map((opt) => (
        <button
          key={String(opt.v)}
          type="button"
          onClick={() => onChange(value === opt.v ? null : opt.v)}
          className={`rounded-lg border px-3 py-1 text-xs font-semibold ${
            value === opt.v ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ChipToggle({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
              active ? "border-brand bg-brand/10 text-brand" : "border-neutral-300 text-neutral-600"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function AnamneseTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [form, setForm] = useState<Anamnese>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/public/extension/anamnese?customer_id=${customerId}`)
      .then((r) => {
        if (cancelled) return;
        if (r?.ok && r.anamnese) {
          setForm({ ...EMPTY, ...r.anamnese, medications: r.anamnese.medications ?? "", allergies_other: r.anamnese.allergies_other ?? "", procedure_history: r.anamnese.procedure_history ?? "", notes: r.anamnese.notes ?? "" });
          setSavedAt(r.anamnese.filled_at ?? null);
        } else {
          setForm(EMPTY);
          setSavedAt(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  function toggle(list: string[], value: string) {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function handleSave() {
    setSaving(true);
    const r = await api("/api/public/extension/anamnese", {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId, ...form }),
    }).catch(() => null);
    setSaving(false);
    if (r?.ok && r.anamnese) setSavedAt(r.anamnese.filled_at ?? null);
  }

  if (loading) return <p className="text-sm text-neutral-400">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Condições de saúde
        </label>
        <ChipToggle
          options={HEALTH_CONDITIONS}
          selected={form.health_conditions}
          onToggle={(v) => setForm((f) => ({ ...f, health_conditions: toggle(f.health_conditions, v) }))}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Medicamentos em uso
        </label>
        <textarea
          value={form.medications ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, medications: e.target.value }))}
          rows={2}
          placeholder="Nome do medicamento, se houver..."
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Alergias
        </label>
        <ChipToggle
          options={ALLERGY_OPTIONS}
          selected={form.allergies}
          onToggle={(v) => setForm((f) => ({ ...f, allergies: toggle(f.allergies, v) }))}
        />
        <input
          value={form.allergies_other ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, allergies_other: e.target.value }))}
          placeholder="Outra alergia..."
          className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Está grávida?
          </label>
          <YesNo value={form.is_pregnant} onChange={(v) => setForm((f) => ({ ...f, is_pregnant: v }))} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Está amamentando?
          </label>
          <YesNo value={form.is_breastfeeding} onChange={(v) => setForm((f) => ({ ...f, is_breastfeeding: v }))} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Tendência a queloide?
          </label>
          <YesNo value={form.keloid_tendency} onChange={(v) => setForm((f) => ({ ...f, keloid_tendency: v }))} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Tipo de pele (Fitzpatrick)
          </label>
          <select
            value={form.skin_type ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, skin_type: e.target.value ? Number(e.target.value) : null }))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">Selecione...</option>
            {SKIN_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Histórico de procedimentos estéticos
        </label>
        <textarea
          value={form.procedure_history ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, procedure_history: e.target.value }))}
          rows={3}
          placeholder="Procedimentos anteriores, reações, satisfação com resultados..."
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Observações gerais
        </label>
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="rounded-lg bg-brand px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Salvando..." : "Salvar ficha"}
        </button>
        {savedAt && (
          <span className="text-xs text-neutral-400">
            Última atualização: {new Date(savedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          </span>
        )}
      </div>
    </div>
  );
}
