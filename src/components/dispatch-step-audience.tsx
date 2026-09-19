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
// Terceira leva de ajustes (19/09, mesmo dia), a partir de feedback de
// uso real:
// - Listas e Funil: sem etapa intermediária (Selecione, Todas as
//   listas), clicar na origem já mostra as opções disponíveis pra
//   escolher diretamente (chips clicáveis, não select). Funil mantém
//   2 níveis (funil, depois etapa), Listas tem só 1 (a lista em si).
// - Assinantes: mesma lógica de chips, com Todos já selecionado por
//   padrão (mostra contatos na hora).
// - Importar planilha: reposicionada no canto inferior da barra lateral,
//   visualmente separada das outras 4 origens (função adicional, não
//   mais uma opção de seleção normal). Antes de importar, não mostra
//   área de contatos vazia, só um botão central de importar. Depois de
//   importar, os contatos aparecem normalmente.
// - Adicionar todos / Remover todos viraram um único botão que alterna
//   de acordo com o estado (todos já selecionados = mostra Remover
//   todos, senão = Adicionar todos).

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

/** Chip clicável genérico, usado pra escolher lista, funil, etapa ou
 * aba de assinante. Sem select, sem placeholder Selecione: as opções
 * já aparecem visíveis assim que a origem é escolhida. */
function OptionChips({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length === 0) {
    return <p className="text-sm text-neutral-500">Nenhuma opção disponível.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            "rounded-full border px-3 py-1.5 text-sm font-medium transition " +
            (value === o.value
              ? "border-brand bg-brand text-white"
              : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

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
        <p className="mb-1.5 text-xs font-medium text-neutral-500">Escolha a lista</p>
        <OptionChips
          options={labelFunnels.map((f) => ({ value: f.id, label: f.name }))}
          value={value.funnelId ?? ""}
          onChange={(funnelId) => onChange({ ...value, funnelId })}
        />
      </div>
    );
  }

  if (value.kind === "funnel") {
    const chosenFunnel = normalFunnels.find((f) => f.id === value.funnelId);
    return (
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-neutral-500">Escolha o funil</p>
          <OptionChips
            options={normalFunnels.map((f) => ({ value: f.id, label: f.name }))}
            value={value.funnelId ?? ""}
            onChange={(funnelId) => onChange({ ...value, funnelId, stageId: "" })}
          />
        </div>
        {chosenFunnel && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-neutral-500">Escolha a etapa</p>
            <OptionChips
              options={[
                { value: "", label: "Todas as etapas" },
                ...chosenFunnel.stages.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={value.stageId ?? ""}
              onChange={(stageId) => onChange({ ...value, stageId })}
            />
          </div>
        )}
      </div>
    );
  }

  if (value.kind === "subscribers" && isBarbearia) {
    return (
      <div>
        <p className="mb-1.5 text-xs font-medium text-neutral-500">Escolha o grupo</p>
        <OptionChips
          options={[
            { value: "all", label: "Todos" },
            ...cols.map((c) => ({ value: c.key, label: c.label })),
          ]}
          value={value.subscriberStatus ?? "all"}
          onChange={(subscriberStatus) => onChange({ ...value, subscriberStatus })}
        />
      </div>
    );
  }

  return null;
}

/** Menu lateral com os tipos de origem. Importar planilha fica separada
 * das outras 4, deslocada pra baixo, pedido explícito do usuário: dar
 * a impressão de função adicional, diferente das opções normais. */
function SourceSidebar({
  value,
  onChange,
  availableKinds,
}: {
  value: AudienceSourceKind;
  onChange: (kind: AudienceSourceKind) => void;
  availableKinds: AudienceSourceKind[];
}) {
  const normalKinds = availableKinds.filter((k) => k !== "sheet");
  const hasSheet = availableKinds.includes("sheet");

  function ItemButton({ k }: { k: AudienceSourceKind }) {
    return (
      <button
        type="button"
        onClick={() => onChange(k)}
        className={
          "block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition " +
          (value === k ? "bg-brand text-white" : "text-neutral-700 hover:bg-neutral-100")
        }
      >
        {SOURCE_LABELS[k]}
      </button>
    );
  }

  return (
    <div className="flex w-36 flex-shrink-0 flex-col justify-between">
      <div className="space-y-1">
        {normalKinds.map((k) => (
          <ItemButton key={k} k={k} />
        ))}
      </div>
      {hasSheet && (
        <div className="mt-8 border-t border-neutral-200 pt-3">
          <ItemButton k="sheet" />
        </div>
      )}
    </div>
  );
}

/** Área de importar planilha, antes de qualquer arquivo escolhido: só um
 * botão central de importar, sem área de contatos vazia por baixo
 * (pedido explícito: não faz sentido mostrar contatos vazios antes de
 * importar qualquer coisa). Botão estilizado no lugar do input nativo,
 * pra não depender do texto "Nenhum arquivo escolhido" do sistema
 * operacional, que estava aparecendo cortado. */
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
        <SourceSidebar value={source.kind} onChange={changeKind} availableKinds={availableKinds} />

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
                <button
                  type="button"
                  onClick={exportDisplayedAsSheet}
                  disabled={displayed.length === 0}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-neutral-500 disabled:opacity-40"
                >
                  Exportar planilha
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
