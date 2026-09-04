// Observações gerais do paciente — sempre visível na ficha, com lápis
// pra editar. Reaproveita customers.notes, que já existe e já tem rota
// de edição pronta (PATCH /customers/:id) — nada novo no banco.

import { useEffect, useState } from "react";

type ApiFn = (path: string, opts?: RequestInit) => Promise<any>;

export function PatientNotesCard({
  api,
  customerId,
  initialNotes,
  bare,
}: {
  api: ApiFn;
  customerId: string;
  initialNotes: string | null;
  /** Quando usado dentro de um modal que já tem título/borda próprios
   * (o popup de Observações), não repete título nem moldura — só o
   * conteúdo. */
  bare?: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNotes(initialNotes ?? "");
    setDraft(initialNotes ?? "");
    setEditing(false);
  }, [customerId, initialNotes]);

  async function save() {
    setSaving(true);
    const res = await api(`/api/public/extension/customers/${customerId}`, {
      method: "PATCH",
      body: JSON.stringify({ notes: draft.trim() || null }),
    });
    setSaving(false);
    if (res?.ok) {
      setNotes(draft.trim());
      setEditing(false);
    }
  }

  return (
    <div className={bare ? "" : "rounded-xl border border-neutral-200 bg-white p-4 print:hidden"}>
      <div className="mb-3 flex items-center justify-between">
        {!bare && <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Observações do paciente</h3>}
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(notes);
              setEditing(true);
            }}
            className={`flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 ${bare ? "ml-auto" : ""}`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="M15 5l4 4" />
            </svg>
            {notes ? "Editar" : "Adicionar"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Alergia, preferência de horário, restrição de saúde, qualquer observação importante sobre esse paciente..."
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : notes ? (
        <p className="whitespace-pre-wrap text-sm text-neutral-700">{notes}</p>
      ) : (
        <p className="text-sm text-neutral-400">Nenhuma observação registrada ainda.</p>
      )}
    </div>
  );
}
