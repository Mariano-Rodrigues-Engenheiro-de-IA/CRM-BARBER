// Mapa corporal — equivalente do odontograma pra clínica de estética.
// Clica numa região do corpo (frente ou costas), escolhe o procedimento,
// marca. Reaproveita a mesma ideia de "clicar na região abre a ficha"
// do odontograma, mas com SVG desenhado à mão (não existe biblioteca
// pronta de mapa corporal com nota clínica embutida, ao contrário do
// odontograma) — mesmo desenho aprovado no protótipo mostrado antes.

import { useEffect, useState } from "react";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

type Marking = {
  id: string;
  view: "front" | "back";
  region: string;
  procedure: string;
  notes: string | null;
  done: boolean;
  created_at: string;
};

type Region = { id: string; label: string; d: string };

const REGIONS_FRONT: Region[] = [
  { id: "rosto", label: "Rosto", d: "M95,20 q15,-14 30,0 q6,18 -4,32 q-11,10 -22,0 q-10,-14 -4,-32 Z" },
  { id: "pescoco", label: "Pescoço", d: "M100,50 h20 v14 h-20 Z" },
  { id: "peito", label: "Peito", d: "M72,66 q38,-14 76,0 l6,44 q-44,16 -88,0 Z" },
  { id: "braco-esquerdo", label: "Braço esquerdo", d: "M64,70 q-16,10 -18,60 q-2,30 6,50 l14,-4 q-6,-42 2,-70 q4,-20 12,-30 Z" },
  { id: "braco-direito", label: "Braço direito", d: "M156,70 q16,10 18,60 q2,30 -6,50 l-14,-4 q6,-42 -2,-70 q-4,-20 -12,-30 Z" },
  { id: "abdomen", label: "Abdômen", d: "M74,112 q36,14 72,0 l-4,50 q-32,14 -64,0 Z" },
  { id: "quadril", label: "Quadril", d: "M70,164 q40,16 80,0 l4,30 q-44,18 -88,0 Z" },
  { id: "coxa-esquerda", label: "Coxa esquerda", d: "M76,196 h32 l-2,90 h-28 Z" },
  { id: "coxa-direita", label: "Coxa direita", d: "M112,196 h32 l-2,90 h-28 Z" },
  { id: "perna-esquerda", label: "Perna esquerda", d: "M78,288 h26 l-2,86 h-22 Z" },
  { id: "perna-direita", label: "Perna direita", d: "M116,288 h26 l-2,86 h-22 Z" },
];

const REGIONS_BACK: Region[] = [
  { id: "nuca", label: "Nuca", d: "M95,18 q15,-12 30,0 v18 h-30 Z" },
  { id: "costas-superior", label: "Costas superior", d: "M72,40 q38,-12 76,0 l4,50 q-42,16 -84,0 Z" },
  { id: "braco-esquerdo-costas", label: "Braço esquerdo", d: "M64,44 q-16,10 -18,60 q-2,30 6,50 l14,-4 q-6,-42 2,-70 q4,-20 12,-30 Z" },
  { id: "braco-direito-costas", label: "Braço direito", d: "M156,44 q16,10 18,60 q2,30 -6,50 l-14,-4 q6,-42 -2,-70 q-4,-20 -12,-30 Z" },
  { id: "lombar", label: "Lombar", d: "M74,90 q36,14 72,0 l-2,44 q-34,14 -68,0 Z" },
  { id: "gluteo", label: "Glúteo", d: "M70,138 q40,18 80,0 l4,34 q-44,18 -88,0 Z" },
  { id: "posterior-coxa-esquerda", label: "Posterior de coxa esquerda", d: "M76,176 h32 l-2,100 h-28 Z" },
  { id: "posterior-coxa-direita", label: "Posterior de coxa direita", d: "M112,176 h32 l-2,100 h-28 Z" },
  { id: "panturrilha-esquerda", label: "Panturrilha esquerda", d: "M78,278 h26 l-2,96 h-22 Z" },
  { id: "panturrilha-direita", label: "Panturrilha direita", d: "M116,278 h26 l-2,96 h-22 Z" },
];

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

const RAMP_FILLS = ["#AFA9EC", "#5DCAA5", "#F0997B", "#ED93B1", "#85B7EB", "#FAC775"];

export function BodyMapTab({ api, customerId }: { api: ApiFn; customerId: string }) {
  const [markings, setMarkings] = useState<Marking[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"front" | "back">("front");
  const [selected, setSelected] = useState<Region | null>(null);
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

  const regions = view === "front" ? REGIONS_FRONT : REGIONS_BACK;
  const markingsByRegion = new Map(markings.map((m) => [`${m.view}:${m.region}`, m]));

  async function handleMark() {
    if (!selected) return;
    setSaving(true);
    const r = await api("/api/public/extension/body-map-markings", {
      method: "POST",
      body: JSON.stringify({ customer_id: customerId, view, region: selected.id, procedure }),
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
      <div className="shrink-0">
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
        <svg width="220" height="440" viewBox="0 0 220 440" role="img" aria-label="Mapa corporal">
          <path
            d="M110,4 q22,0 22,22 q0,16 -10,26 q30,10 34,72 q4,56 -4,90 q30,10 34,86 q6,66 -8,106 l-2,120 h-26 l-4,-92 l-4,92 h-24 l-2,-118 l-2,118 h-24 l-4,-92 l-4,92 h-26 l-2,-120 q-14,-40 -8,-106 q4,-76 34,-86 q-8,-34 -4,-90 q4,-62 34,-72 q-10,-10 -10,-26 q0,-22 22,-22 Z"
            fill="#F5F5F0"
            stroke="#B4B2A9"
            strokeWidth={1}
          />
          {regions.map((r, i) => {
            const key = `${view}:${r.id}`;
            const mark = markingsByRegion.get(key);
            const idx = markings.findIndex((m) => `${m.view}:${m.region}` === key);
            return (
              <path
                key={r.id}
                d={r.d}
                fill={mark ? RAMP_FILLS[idx % RAMP_FILLS.length] : "transparent"}
                stroke={selected?.id === r.id ? "#185FA5" : "#D3D1C7"}
                strokeWidth={selected?.id === r.id ? 2 : 0.5}
                style={{ cursor: "pointer" }}
                onClick={() => setSelected(r)}
              />
            );
          })}
        </svg>
      </div>

      <div className="min-w-[240px] flex-1">
        {!selected ? (
          <p className="text-sm text-neutral-400">Clique numa região do corpo pra marcar um procedimento.</p>
        ) : (
          <div className="mb-5">
            <p className="mb-1 text-xs text-neutral-500">Região selecionada</p>
            <p className="mb-3 text-base font-bold text-neutral-900">{selected.label}</p>
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
              {markings.map((m, i) => {
                const region = [...REGIONS_FRONT, ...REGIONS_BACK].find((r) => r.id === m.region);
                return (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: RAMP_FILLS[i % RAMP_FILLS.length] }}
                    />
                    <span className={`flex-1 ${m.done ? "text-neutral-400 line-through" : "text-neutral-700"}`}>
                      {region ? region.label : m.region}: {m.procedure}
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
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
