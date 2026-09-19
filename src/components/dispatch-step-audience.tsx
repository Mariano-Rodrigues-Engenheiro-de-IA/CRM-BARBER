// Etapa 1 do wizard de disparo: escolher o público.
//
// Fluxo: escolhe 1 fonte de INCLUSÃO (obrigatória) → opcionalmente
// adiciona 1+ fontes de EXCLUSÃO (ex: "todo o Inbox, exceto quem está no
// Funil X") → a lista final (inclusão menos exclusão, deduplicada por
// telefone) aparece nominalmente, com uma bolinha por pessoa pra remover
// manualmente quem não deveria receber.
//
// Grupos do WhatsApp ficam de fora por enquanto (pedido explícito do
// usuário, 19/09 — "deixa os grupos pra depois").

import { useMemo, useState } from "react";
import { fileToContacts } from "@/lib/sheet-contacts";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import {
  resolveFinalAudience,
  type AudienceContact,
  type AudienceSource,
  type AudienceSourceKind,
  type DispatchCustomer,
} from "@/lib/dispatch-audience";

const inputCls =
  "w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-900";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-neutral-600">{children}</label>;
}

const SOURCE_LABELS: Record<AudienceSourceKind, string> = {
  inbox: "Inbox",
  labels: "Etiquetas",
  funnel: "Funil",
  subscribers: "Assinantes",
  sheet: "Contatos (planilha)",
};

/** Seletor de UMA fonte (usado tanto pra inclusão quanto exclusão) —
 * escolhe o tipo e, dependendo do tipo, mostra os campos extras
 * (funil+etapa, status de assinante, upload de planilha). */
function SourcePicker({
  value,
  onChange,
  funnels,
  cols,
  isBarbearia,
  availableKinds,
}: {
  value: AudienceSource;
  onChange: (next: AudienceSource) => void;
  funnels: Funnel[];
  cols: Array<{ key: string; label: string }>;
  isBarbearia: boolean;
  availableKinds: AudienceSourceKind[];
}) {
  const labelFunnels = funnels.filter((f) => f.mode === "label");
  const normalFunnels = funnels.filter((f) => f.mode !== "label");
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <select
        value={value.kind}
        onChange={(e) => onChange({ kind: e.target.value as AudienceSourceKind })}
        className={inputCls}
      >
        {availableKinds.map((k) => (
          <option key={k} value={k}>
            {SOURCE_LABELS[k]}
          </option>
        ))}
      </select>

      {value.kind === "labels" && (
        <div className="grid grid-cols-2 gap-2">
          <select
            value={value.funnelId ?? ""}
            onChange={(e) => onChange({ ...value, funnelId: e.target.value, stageId: "" })}
            className={inputCls}
          >
            <option value="">Escolha a lista</option>
            {labelFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            value={value.stageId ?? ""}
            onChange={(e) => onChange({ ...value, stageId: e.target.value })}
            className={inputCls}
          >
            <option value="">Todas as etiquetas</option>
            {(labelFunnels.find((f) => f.id === value.funnelId)?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.kind === "funnel" && (
        <div className="grid grid-cols-2 gap-2">
          <select
            value={value.funnelId ?? ""}
            onChange={(e) => onChange({ ...value, funnelId: e.target.value, stageId: "" })}
            className={inputCls}
          >
            <option value="">Escolha o funil</option>
            {normalFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            value={value.stageId ?? ""}
            onChange={(e) => onChange({ ...value, stageId: e.target.value })}
            className={inputCls}
          >
            <option value="">Todas as colunas</option>
            {(normalFunnels.find((f) => f.id === value.funnelId)?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.kind === "subscribers" && isBarbearia && (
        <select
          value={value.subscriberStatus ?? "all"}
          onChange={(e) => onChange({ ...value, subscriberStatus: e.target.value })}
          className={inputCls}
        >
          <option value="all">Todos</option>
          {cols.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      )}

      {value.kind === "sheet" && (
        <div>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.tsv,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setSheetErr(null);
              try {
                const rows = await fileToContacts(file);
                if (!rows.length) {
                  setSheetErr("Nenhum contato válido. A planilha precisa ter Nome e Telefone.");
                  return;
                }
                onChange({ ...value, sheetContacts: rows });
              } catch {
                setSheetErr("Não consegui ler esse arquivo.");
              }
            }}
            className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
          />
          {value.sheetContacts && value.sheetContacts.length > 0 && (
            <p className="mt-1 text-xs text-neutral-500">
              {value.sheetContacts.length} contato(s) prontos.
            </p>
          )}
          {sheetErr && <p className="mt-1 text-xs text-red-500">{sheetErr}</p>}
        </div>
      )}
    </div>
  );
}

export function AudienceStep({
  funnels,
  contacts,
  labels,
  customers,
  cols,
  isBarbearia,
  onNext,
}: {
  funnels: Funnel[];
  contacts: WaContact[];
  labels: WaLabel[];
  customers: DispatchCustomer[];
  cols: Array<{ key: string; label: string }>;
  isBarbearia: boolean;
  onNext: (finalList: AudienceContact[]) => void;
}) {
  const availableKinds: AudienceSourceKind[] = isBarbearia
    ? ["inbox", "labels", "funnel", "subscribers", "sheet"]
    : ["inbox", "labels", "funnel", "sheet"];

  const [include, setInclude] = useState<AudienceSource>({ kind: availableKinds[0] });
  const [excludeList, setExcludeList] = useState<AudienceSource[]>([]);
  // Removidos manualmente da lista final, por telefone — reseta sempre
  // que a fonte de inclusão ou exclusão muda (a lista final é outra,
  // manter remoções antigas não faria sentido).
  const [manuallyRemoved, setManuallyRemoved] = useState<Set<string>>(new Set());

  const data = useMemo(
    () => ({ contacts, labels, funnels, customers }),
    [contacts, labels, funnels, customers],
  );

  const finalList = useMemo(
    () => resolveFinalAudience(include, excludeList, data),
    [include, excludeList, data],
  );
  const visibleList = useMemo(
    () => finalList.filter((c) => !manuallyRemoved.has(c.phone)),
    [finalList, manuallyRemoved],
  );

  function updateInclude(next: AudienceSource) {
    setInclude(next);
    setManuallyRemoved(new Set());
  }
  function updateExclude(index: number, next: AudienceSource) {
    setExcludeList((list) => list.map((s, i) => (i === index ? next : s)));
    setManuallyRemoved(new Set());
  }
  function addExclude() {
    setExcludeList((list) => [...list, { kind: availableKinds[0] }]);
  }
  function removeExclude(index: number) {
    setExcludeList((list) => list.filter((_, i) => i !== index));
    setManuallyRemoved(new Set());
  }
  function toggleRemoved(phone: string) {
    setManuallyRemoved((set) => {
      const next = new Set(set);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <Label>Enviar para</Label>
        <SourcePicker
          value={include}
          onChange={updateInclude}
          funnels={funnels}
          cols={cols}
          isBarbearia={isBarbearia}
          availableKinds={availableKinds}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Exceto (opcional)</Label>
          <button
            type="button"
            onClick={addExclude}
            className="text-xs font-semibold text-brand hover:underline"
          >
            + Adicionar exclusão
          </button>
        </div>
        {excludeList.length === 0 ? (
          <p className="text-xs text-neutral-400">
            Nenhuma exclusão — todos da fonte acima vão receber.
          </p>
        ) : (
          <div className="space-y-2">
            {excludeList.map((src, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1">
                  <SourcePicker
                    value={src}
                    onChange={(next) => updateExclude(i, next)}
                    funnels={funnels}
                    cols={cols}
                    isBarbearia={isBarbearia}
                    availableKinds={availableKinds}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeExclude(i)}
                  className="mt-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-red-400 hover:text-red-600"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Destinatários ({visibleList.length})</Label>
          {manuallyRemoved.size > 0 && (
            <span className="text-xs text-neutral-500">
              {manuallyRemoved.size} removido(s) manualmente
            </span>
          )}
        </div>
        {finalList.length === 0 ? (
          <p className="text-sm text-neutral-500">Nenhum contato encontrado com essa fonte.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-xl border border-neutral-200">
            {finalList.map((c) => {
              const removed = manuallyRemoved.has(c.phone);
              return (
                <button
                  key={c.phone}
                  type="button"
                  onClick={() => toggleRemoved(c.phone)}
                  className={
                    "flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-b-0 " +
                    (removed
                      ? "bg-neutral-50 text-neutral-400 line-through"
                      : "text-neutral-800 hover:bg-neutral-50")
                  }
                >
                  <span
                    className={
                      "h-4 w-4 flex-shrink-0 rounded-full border-2 " +
                      (removed ? "border-neutral-300" : "border-brand bg-brand")
                    }
                  />
                  <span className="min-w-0 truncate">{c.name || c.phone}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={visibleList.length === 0}
        onClick={() => onNext(visibleList)}
        className="w-full rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
      >
        Próxima etapa
      </button>
    </div>
  );
}
