// Etapa 1 do wizard de disparo: escolher o público.
//
// Modelo de seleção ACUMULATIVA (reescrito 19/09, a partir de feedback
// real de uso): a origem (Inbox, Lista, Funil, Assinantes, Planilha) é só
// um FILTRO de exibição, não define a lista final por si só. A seleção
// real é um conjunto de contatos que cresce e diminui conforme o usuário
// usa "Adicionar todos" / "Remover todos" na origem que estiver olhando
// no momento, ou marca/desmarca contatos individualmente. Trocar de
// origem NUNCA apaga a seleção já feita, só muda quem está sendo
// exibido pra adicionar ou remover em massa.
//
// Estado (source, selected) é CONTROLADO pelo componente pai
// (DispatchCenter), não vive aqui dentro. Isso é proposital: se fosse
// estado local, ele se perderia toda vez que o wizard saísse da Etapa 1
// (React desmonta o componente ao trocar de etapa), fazendo a
// configuração "desaparecer" ao voltar, bug real reportado pelo usuário.
//
// Quarta leva de ajustes (19/09, mesmo dia), a partir de feedback de
// uso real:
// - Listas, Funil e Assinantes voltam a usar select (não mais chips
//   lado a lado, que o usuário considerou errado pro caso de Funil
//   especificamente), com largura MÉDIA (nem minúscula, nem esticada),
//   classe própria (mediumSelectCls).
// - Listas: 1 select, sem "Todas as listas" (mantém o comportamento da
//   leva anterior, só muda a representação visual pra select).
// - Funil: 2 selects (funil, depois etapa).
// - Assinantes: 1 select (Todos + abas), com Todos pré-selecionado.
// - Importar planilha volta pro grupo normal da sidebar (Inbox, Listas,
//   Funil, Assinantes, Importar planilha). Quem fica deslocado embaixo,
//   separado, é EXPORTAR planilha (não mais Importar, isso tinha
//   ficado invertido na leva anterior).

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { fileToContacts, type SheetContact } from "@/lib/sheet-contacts";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import {
  resolveAudienceSource,
  firstAvailableSource,
  type AudienceContact,
  type AudienceSource,
  type AudienceSourceKind,
  type DispatchCustomer,
} from "@/lib/dispatch-audience";

// Seletor de tamanho MÉDIO, nem minúsculo (do tamanho do texto), nem
// esticado (w-full). Largura fixa confortável pra clicar e ler a opção
// escolhida.
const mediumSelectCls =
  "w-56 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-neutral-900";

const SOURCE_LABELS: Record<AudienceSourceKind, string> = {
  inbox: "Inbox",
  labels: "Listas",
  funnel: "Funil",
  subscribers: "Assinantes",
  sheet: "Importar planilha",
};

function SelectionDot({ selected }: { selected: boolean }) {
  return (
    <span
      className={
        "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 transition " +
        (selected
          ? "border-brand bg-brand text-white"
          : "border-neutral-400 bg-white text-transparent")
      }
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 010 1.4l-7.4 7.4a1 1 0 01-1.4 0L3.3 9.5a1 1 0 111.4-1.4l3.9 3.9 6.7-6.7a1 1 0 011.4 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

/** Sub-filtro da origem escolhida: o(s) select(s) específico(s) de cada
 * tipo. Não inclui a escolha do TIPO em si (isso é a sidebar) nem a
 * parte de planilha (fica numa área própria, ver AudienceStep). */
function SourceSubFilter({
  value,
  onChange,
  funnels,
  cols,
  isBarbearia,
}: {
  value: AudienceSource;
  onChange: (next: AudienceSource) => void;
  funnels: Funnel[];
  cols: Array<{ key: string; label: string }>;
  isBarbearia: boolean;
}) {
  const labelFunnels = funnels.filter((f) => f.mode === "label");
  const normalFunnels = funnels.filter((f) => f.mode !== "label");

  if (value.kind === "inbox" || value.kind === "sheet") return null;

  if (value.kind === "labels") {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-neutral-500">Lista</p>
        <select
          value={value.funnelId ?? ""}
          onChange={(e) => onChange({ ...value, funnelId: e.target.value })}
          className={mediumSelectCls}
        >
          <option value="">Escolha uma lista</option>
          {labelFunnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (value.kind === "funnel") {
    const chosenFunnel = normalFunnels.find((f) => f.id === value.funnelId);
    return (
      <div className="flex flex-wrap gap-4">
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Funil</p>
          <select
            value={value.funnelId ?? ""}
            onChange={(e) => onChange({ ...value, funnelId: e.target.value, stageId: "" })}
            className={mediumSelectCls}
          >
            <option value="">Escolha o funil</option>
            {normalFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Etapa/Aba</p>
          <select
            value={value.stageId ?? ""}
            onChange={(e) => onChange({ ...value, stageId: e.target.value })}
            disabled={!chosenFunnel}
            className={mediumSelectCls + " disabled:opacity-50"}
          >
            <option value="">Todas as etapas</option>
            {(chosenFunnel?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (value.kind === "subscribers" && isBarbearia) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-neutral-500">Assinantes</p>
        <select
          value={value.subscriberStatus ?? "all"}
          onChange={(e) => onChange({ ...value, subscriberStatus: e.target.value })}
          className={mediumSelectCls}
        >
          <option value="all">Todos os assinantes</option>
          {cols.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return null;
}

/** Menu lateral com os tipos de origem. Importar planilha fica no grupo
 * normal (é uma origem de contatos igual às outras 4). Exportar
 * planilha é uma AÇÃO, não uma origem, fica deslocada embaixo,
 * separada, dando a impressão de função adicional. */
function SourceSidebar({
  value,
  onChange,
  availableKinds,
  onExport,
  exportDisabled,
}: {
  value: AudienceSourceKind;
  onChange: (kind: AudienceSourceKind) => void;
  availableKinds: AudienceSourceKind[];
  onExport: () => void;
  exportDisabled: boolean;
}) {
  return (
    <div className="flex w-36 flex-shrink-0 flex-col justify-between">
      <div className="space-y-1">
        {availableKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={
              "block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition " +
              (value === k ? "bg-brand text-white" : "text-neutral-700 hover:bg-neutral-100")
            }
          >
            {SOURCE_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="mt-8 border-t border-neutral-200 pt-3">
        <button
          type="button"
          onClick={onExport}
          disabled={exportDisabled}
          className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-40"
        >
          Exportar planilha
        </button>
      </div>
    </div>
  );
}

/** Área de importar planilha, antes de qualquer arquivo escolhido: só um
 * botão central de importar, sem área de contatos vazia por baixo.
 * Botão estilizado no lugar do input nativo, pra não depender do texto
 * "Nenhum arquivo escolhido" do sistema operacional, que aparecia
 * cortado. */
function SheetImportPrompt({ onImported }: { onImported: (rows: SheetContact[]) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-300 p-8 text-center">
      <p className="text-sm font-medium text-neutral-700">
        Importe uma planilha com Nome e Telefone
      </p>
      <label className="cursor-pointer rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-strong">
        Escolher arquivo
        <input
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setErr(null);
            try {
              const rows = await fileToContacts(file);
              if (!rows.length) {
                setErr("Nenhum contato válido, a planilha precisa ter Nome e Telefone.");
                return;
              }
              setFileName(file.name);
              onImported(rows);
            } catch {
              setErr("Não consegui ler esse arquivo.");
            }
          }}
        />
      </label>
      {fileName && <p className="text-xs text-neutral-500">{fileName}</p>}
      {err && <p className="text-xs text-red-500">{err}</p>}
      <p className="text-xs text-neutral-400">.xlsx, .xls ou .csv</p>
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
  source,
  onSourceChange,
  selected,
  onSelectedChange,
  onNext,
}: {
  funnels: Funnel[];
  contacts: WaContact[];
  labels: WaLabel[];
  customers: DispatchCustomer[];
  cols: Array<{ key: string; label: string }>;
  isBarbearia: boolean;
  // Controlado pelo pai, ver comentário no topo do arquivo.
  source: AudienceSource;
  onSourceChange: (next: AudienceSource) => void;
  selected: Map<string, string>;
  onSelectedChange: (next: Map<string, string>) => void;
  onNext: (finalList: AudienceContact[]) => void;
}) {
  const availableKinds: AudienceSourceKind[] = isBarbearia
    ? ["inbox", "labels", "funnel", "subscribers", "sheet"]
    : ["inbox", "labels", "funnel", "sheet"];

  const data = useMemo(
    () => ({ contacts, labels, funnels, customers }),
    [contacts, labels, funnels, customers],
  );

  // Lista exibida agora, pra origem atual, NÃO é a seleção final, é só o
  // que está sendo mostrado pra adicionar/remover em massa ou marcar
  // individualmente.
  const displayed = useMemo(() => resolveAudienceSource(source, data), [source, data]);

  function changeKind(kind: AudienceSourceKind) {
    onSourceChange(firstAvailableSource(kind));
  }

  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((c) => selected.has(c.phone));

  function toggleAllDisplayed() {
    const next = new Map(selected);
    if (allDisplayedSelected) {
      for (const c of displayed) next.delete(c.phone);
    } else {
      for (const c of displayed) next.set(c.phone, c.name);
    }
    onSelectedChange(next);
  }
  function toggleOne(c: AudienceContact) {
    const next = new Map(selected);
    if (next.has(c.phone)) next.delete(c.phone);
    else next.set(c.phone, c.name);
    onSelectedChange(next);
  }

  /** Exporta os contatos da origem sendo exibida agora, não a seleção
   * final. */
  function exportDisplayedAsSheet() {
    const rows = displayed.map((c) => ({ Nome: c.name, Telefone: c.phone }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contatos");
    const sourceLabel = SOURCE_LABELS[source.kind]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-");
    XLSX.writeFile(wb, `contatos-${sourceLabel}.xlsx`);
  }

  const selectedList = useMemo(
    () => Array.from(selected, ([phone, name]) => ({ phone, name })),
    [selected],
  );
  const canAdvance = selected.size > 0;

  // Planilha antes de qualquer arquivo importado: nada pra mostrar como
  // contato ainda, então a área principal mostra só o prompt de
  // importação, sem lista vazia por baixo.
  const showSheetPrompt = source.kind === "sheet" && !source.sheetContacts?.length;

  return (
    // Altura relativa à tela do usuário, a lista de contatos cresce pra
    // ocupar o espaço vertical disponível.
    <div className="flex" style={{ height: "calc(100vh - 260px)", minHeight: 360 }}>
      <div className="flex min-h-0 flex-1 gap-4">
        <SourceSidebar
          value={source.kind}
          onChange={changeKind}
          availableKinds={availableKinds}
          onExport={exportDisplayedAsSheet}
          exportDisabled={displayed.length === 0}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <SourceSubFilter
            value={source}
            onChange={onSourceChange}
            funnels={funnels}
            cols={cols}
            isBarbearia={isBarbearia}
          />

          {showSheetPrompt ? (
            <SheetImportPrompt
              onImported={(rows) => onSourceChange({ ...source, sheetContacts: rows })}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleAllDisplayed}
                  disabled={displayed.length === 0}
                  className={
                    "rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 " +
                    (allDisplayedSelected
                      ? "border-neutral-300 bg-white text-neutral-700 hover:border-red-400 hover:text-red-600"
                      : "border-brand bg-brand/10 text-brand hover:bg-brand/20")
                  }
                >
                  {allDisplayedSelected ? "Remover todos" : `Adicionar todos (${displayed.length})`}
                </button>
                <span className="ml-auto text-xs text-neutral-500">
                  {selected.size} selecionado(s) no total
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-200">
                {displayed.length === 0 ? (
                  <p className="p-3 text-sm text-neutral-500">
                    {source.kind === "labels" && !source.funnelId
                      ? "Escolha uma lista acima."
                      : source.kind === "funnel" && !source.funnelId
                        ? "Escolha um funil acima."
                        : "Nenhum contato encontrado nessa origem."}
                  </p>
                ) : (
                  displayed.map((c) => {
                    const isSelected = selected.has(c.phone);
                    return (
                      <button
                        key={c.phone}
                        type="button"
                        onClick={() => toggleOne(c)}
                        className={
                          "flex w-full items-center gap-3 border-b border-neutral-100 px-3 py-2.5 text-left text-sm last:border-b-0 " +
                          (isSelected
                            ? "bg-brand/5 text-neutral-900"
                            : "text-neutral-700 hover:bg-neutral-50")
                        }
                      >
                        <SelectionDot selected={isSelected} />
                        <span className="min-w-0 truncate">{c.name || c.phone}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center pl-3">
        <button
          type="button"
          disabled={!canAdvance}
          onClick={() => onNext(selectedList)}
          title={
            canAdvance
              ? `Próxima etapa, ${selected.size} destinatário(s)`
              : "Selecione pelo menos 1 contato"
          }
          className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:border-brand hover:bg-brand hover:text-white disabled:opacity-30 disabled:hover:border-neutral-300 disabled:hover:bg-transparent disabled:hover:text-neutral-600"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path
              fillRule="evenodd"
              d="M7.3 14.7a1 1 0 010-1.4L10.6 10 7.3 6.7a1 1 0 011.4-1.4l4 4a1 1 0 010 1.4l-4 4a1 1 0 01-1.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
