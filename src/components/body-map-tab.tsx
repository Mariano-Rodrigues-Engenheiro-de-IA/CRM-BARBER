// Mapa corporal — equivalente do odontograma pra clínica de estética.
// Usa a biblioteca react-body-highlighter (corpo anatômico de verdade,
// com coordenadas reais de cada região — MIT, npm), a mesma ideia do
// odontograma: "clicar na região abre a ficha". A primeira versão desse
// componente desenhava o corpo à mão (rascunho simples, sem parecer um
// corpo real) — trocado por pedido do Mariano depois de ver o
// resultado, pelo mesmo padrão de qualidade do odontograma.

import { useEffect, useState } from "react";
import Model, { Muscle, IExerciseData } from "react-body-highlighter";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type Marking = {
  id: string;
  view: "front" | "back";
  region: Muscle;
  procedure: string;
  notes: string | null;
  done: boolean;
  created_at: string;
};

const REGION_LABELS: Record<Muscle, string> = {
  trapezius: "Trapézio",
  "upper-back": "Costas superior",
  "lower-back": "Lombar",
  chest: "Peito",
  biceps: "Bíceps",
  triceps: "Tríceps",
  forearm: "Antebraço",
  "back-deltoids": "Ombro (posterior)",
  "front-deltoids": "Ombro (anterior)",
  abs: "Abdômen",
  obliques: "Oblíquos",
  adductor: "Adutor",
  abductors: "Abdutores",
  hamstring: "Posterior de coxa",
  quadriceps: "Quadríceps",
  calves: "Panturrilha",
  gluteal: "Glúteo",
  head: "Rosto",
  neck: "Pescoço",
  knees: "Joelhos",
  "left-soleus": "Solear esquerdo",
  "right-soleus": "Solear direito",
};

const PROCEDIMENTOS = [
  "Botox",
  "Preenchimento",
  "Depilação a laser",
  "Drenagem linfática",
  "Criolipólise",
  "Radiofrequência",
  "Peeling",
  "Outro",
];

const HIGHLIGHT_COLOR = "#5DCAA5";

export function BodyMapTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [markings, setMarkings] = useState<Marking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"front" | "back">("front");
  const [selected, setSelected] = useState<Muscle | null>(null);
  const [procedure, setProcedure] = useState(PROCEDIMENTOS[0]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/public/extension/body-map-markings?customer_id=${customerId}`)
      .then((r) => {
        if (!cancelled && r?.ok) setMarkings(r.markings || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Biblioteca espera uma lista de "exercícios" (nome + músculos
  // trabalhados) — reaproveitado aqui como "procedimento + região",
  // só pra pintar quem já tem marcação (frequency > 0 vira destacado).
  const chartData: IExerciseData[] = markings
    .filter((m) => m.view === view)
    .map((m) => ({ name: m.procedure, muscles: [m.region] }));

  async function handleMark() {
    if (!selected) return;
    setSaving(true);
    const r = await api("/api/public/extension/body-map-markings", {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId, view, region: selected, procedure }),
    }).catch(() => null);
    setSaving(false);
    if (r?.ok && r.marking) {
      setMarkings((prev) => [...prev, r.marking]);
      setSelected(null);
    }
  }

  async function handleToggleDone(m: Marking) {
    const r = await api(`/api/public/extension/body-map-markings/${m.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !m.done }),
    }).catch(() => null);
    if (r?.ok && r.marking) {
      setMarkings((prev) => prev.map((x) => (x.id === m.id ? r.marking : x)));
    }
  }

  async function handleDelete(m: Marking) {
    const r = await api(`/api/public/extension/body-map-markings/${m.id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) setMarkings((prev) => prev.filter((x) => x.id !== m.id));
  }

  if (loading) return <p className="text-sm text-neutral-400">Carregando...</p>;

  return (
    <div className="flex flex-wrap gap-6">
      <div className="w-[220px] shrink-0">
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setView("front");
              setSelected(null);
            }}
            className={`rounded-lg border px-3 py-1 text-xs font-semibold ${view === "front" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"}`}
          >
            Frente
          </button>
          <button
            type="button"
            onClick={() => {
              setView("back");
              setSelected(null);
            }}
            className={`rounded-lg border px-3 py-1 text-xs font-semibold ${view === "back" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600"}`}
          >
            Costas
          </button>
        </div>
        <Model
          type={view === "front" ? "anterior" : "posterior"}
          data={chartData}
          style={{ width: "220px" }}
          bodyColor="#F5F5F0"
          highlightedColors={[HIGHLIGHT_COLOR]}
          onClick={(result) => setSelected(result.muscle)}
        />
      </div>

      <div className="min-w-[240px] flex-1">
        {!selected ? (
          <p className="text-sm text-neutral-400">Clique numa região do corpo pra marcar um procedimento.</p>
        ) : (
          <div className="mb-5">
            <p className="mb-1 text-xs text-neutral-500">Região selecionada</p>
            <p className="mb-3 text-base font-bold text-neutral-900">{REGION_LABELS[selected] ?? selected}</p>
            <label className="mb-1 block text-xs text-neutral-500">Procedimento</label>
            <select
              value={procedure}
              onChange={(e) => setProcedure(e.target.value)}
              className="mb-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
            >
              {PROCEDIMENTOS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={saving}
              onClick={handleMark}
              className="w-full rounded-lg bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Marcando..." : "Marcar região"}
            </button>
          </div>
        )}

        {markings.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Regiões marcadas</p>
            <div className="space-y-1.5">
              {markings.map((m) => (
                <div key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: HIGHLIGHT_COLOR }} />
                  <span className={`flex-1 ${m.done ? "text-neutral-400 line-through" : "text-neutral-700"}`}>
                    {REGION_LABELS[m.region] ?? m.region} ({m.view === "front" ? "frente" : "costas"}): {m.procedure}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleToggleDone(m)}
                    title={m.done ? "Marcar como pendente" : "Marcar como feito"}
                    className="text-xs text-neutral-400 hover:text-emerald-600"
                  >
                    {m.done ? "Desfazer" : "Feito"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(m)}
                    title="Remover"
                    className="text-xs text-neutral-400 hover:text-red-600"
                  >
                    Remover
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
