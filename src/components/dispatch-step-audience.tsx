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
// Isso substitui o modelo anterior (fonte de inclusão + lista de fontes
// de exclusão), que era confuso e tinha um fluxo de exclusão separado e
// pouco intuitivo. Agora "excluir" é só usar "Remover todos" na origem
// errada, não existe mais um modo separado pra isso.
//
// Estado (source, selected) é CONTROLADO pelo componente pai
// (DispatchCenter), não vive aqui dentro. Isso é proposital: se fosse
// estado local, ele se perderia toda vez que o wizard saísse da Etapa 1
// (React desmonta o componente ao trocar de etapa), fazendo a
// configuração "desaparecer" ao voltar, bug real reportado pelo usuário.
//
// Segunda leva de ajustes (19/09, mesmo dia), a partir de feedback de
// uso real: "Listas" simplificado pra um único seletor compacto (sem
// segundo nível de etiqueta específica); seletores compactos em vez de
// esticados (w-full) em toda a tela; botão inferior grande trocado por
// uma seta discreta na lateral; lista de contatos com altura responsiva
// ao tamanho da tela, em vez de uma altura fixa pequena.

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { fileToContacts } from "@/lib/sheet-contacts";
import type { Funnel, WaContact, WaLabel } from "@/lib/funnels";
import {
  resolveAudienceSource,
  firstAvailableSource,
  type AudienceContact,
  type AudienceSource,
  type AudienceSourceKind,
  type DispatchCustomer,
} from "@/lib/dispatch-audience";

// Seletor COMPACTO — largura pelo conteúdo, não esticado (feedback real:
// "o seletor de Assinantes ficou gigantesco"). max-w evita que um nome
// muito longo estique demais mesmo assim.
const compactSelectCls =
  "w-auto max-w-[220px] rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-neutral-900";

const SOURCE_LABELS: Record<AudienceSourceKind, string> = {
  inbox: "Inbox",
  labels: "Listas",
  funnel: "Funil",
  subscribers: "Assinantes",
  sheet: "Importar planilha",
};

/** Bolinha de seleção, precisa deixar muito claro, à primeira vista, que
 * é um controle clicável (feedback real: "quase não dá pra perceber que
 * é possível selecionar"). Selecionado: preenchida com a cor da marca e
 * um check visível. Não selecionado: vazia, com borda grossa e
 * contrastante. */
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

/** Sub-filtro da origem escolhida: o funil/lista específico, coluna do
 * Kanban, ou upload de planilha. Não inclui mais a escolha do TIPO em
 * si (isso é a sidebar, ver AudienceStep) — só o que é específico de
 * cada tipo. */
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
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  if (value.kind === "inbox") return null;

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Listas: um único seletor compacto (todas ou uma específica) —
         antes tinha um segundo nível pra etiqueta dentro da lista, que
         o usuário não considerou necessário. */}
      {value.kind === "labels" && (
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Lista</p>
          <select
            value={value.funnelId ?? ""}
            onChange={(e) => onChange({ ...value, funnelId: e.target.value })}
            className={compactSelectCls}
          >
            <option value="">Todas as listas</option>
            {labelFunnels.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Funil: mantém os 2 níveis (funil, depois etapa/coluna), aqui
         são realmente necessários. */}
      {value.kind === "funnel" && (
        <>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-500">Escolha o funil</p>
            <select
              value={value.funnelId ?? ""}
              onChange={(e) => onChange({ ...value, funnelId: e.target.value, stageId: "" })}
              className={compactSelectCls}
            >
              <option value="">Selecione</option>
              {normalFunnels.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-neutral-500">Escolha a etapa</p>
            <select
              value={value.stageId ?? ""}
              onChange={(e) => onChange({ ...value, stageId: e.target.value })}
              className={compactSelectCls}
            >
              <option value="">Todas as etapas</option>
              {(normalFunnels.find((f) => f.id === value.funnelId)?.stages ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {value.kind === "subscribers" && isBarbearia && (
        <div>
          <p className="mb-1 text-xs font-medium text-neutral-500">Kanban</p>
          <select
            value={value.subscriberStatus ?? "all"}
            onChange={(e) => onChange({ ...value, subscriberStatus: e.target.value })}
            className={compactSelectCls}
          >
            <option value="all">Todos</option>
            {cols.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
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
                  setSheetErr("Nenhum contato válido, a planilha precisa ter Nome e Telefone.");
                  return;
                }
                onChange({ ...value, sheetContacts: rows });
              } catch {
                setSheetErr("Não consegui ler esse arquivo.");
              }
            }}
            className="text-sm text-neutral-800 file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
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

/** Menu lateral fixo com os tipos de origem, pedido explícito do usuário
 * (19/09): antes a origem ficava escondida num dropdown que precisava
 * reabrir pra lembrar de onde já tinha puxado contato, deixando fácil se
 * perder ao combinar várias origens. Com a origem sempre visível do
 * lado, fica claro onde já mexeu e onde ainda não. */
function SourceSidebar({
  value,
  onChange,
  availableKinds,
}: {
  value: AudienceSourceKind;
  onChange: (kind: AudienceSourceKind) => void;
  availableKinds: AudienceSourceKind[];
}) {
  return (
    <div className="w-36 flex-shrink-0 space-y-1">
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
    // Sempre pré-seleciona a primeira opção disponível (primeiro funil,
    // "todas as listas") e já mostra os contatos dela na hora, nunca
    // deixa a área de contatos vazia esperando uma escolha manual.
    onSourceChange(firstAvailableSource(kind, data));
  }

  function addAllDisplayed() {
    const next = new Map(selected);
    for (const c of displayed) next.set(c.phone, c.name);
    onSelectedChange(next);
  }
  function removeAllDisplayed() {
    const next = new Map(selected);
    for (const c of displayed) next.delete(c.phone);
    onSelectedChange(next);
  }
  function toggleOne(c: AudienceContact) {
    const next = new Map(selected);
    if (next.has(c.phone)) next.delete(c.phone);
    else next.set(c.phone, c.name);
    onSelectedChange(next);
  }

  /** Exporta os contatos da origem sendo exibida agora, não a seleção
   * final, ex: escolhe um funil, exporta os contatos daquele funil,
   * independente de estarem marcados ou não na seleção do disparo. */
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
  const allDisplayedSelected =
    displayed.length > 0 && displayed.every((c) => selected.has(c.phone));
  const canAdvance = selected.size > 0;

  return (
    // Altura relativa à tela do usuário (feedback real: "hoje existe
    // muito espaço vazio embaixo") — a lista de contatos cresce pra
    // ocupar o espaço vertical disponível, telas maiores mostram mais
    // contatos de uma vez, sem precisar rolar tanto.
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

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addAllDisplayed}
              disabled={displayed.length === 0 || allDisplayedSelected}
              className="rounded-lg border border-brand bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-40"
            >
              Adicionar todos ({displayed.length})
            </button>
            <button
              type="button"
              onClick={removeAllDisplayed}
              disabled={displayed.length === 0}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-red-400 hover:text-red-600 disabled:opacity-40"
            >
              Remover todos
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

          {/* flex-1 + min-h-0: a lista ocupa todo o espaço vertical que
             sobrar dentro da altura calculada acima, em vez de uma
             altura fixa pequena. */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-neutral-200">
            {displayed.length === 0 ? (
              <p className="p-3 text-sm text-neutral-500">
                Nenhum contato encontrado nessa origem.
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
        </div>
      </div>

      {/* Seta de navegação discreta, em vez do botão grande esticado
         (feedback real: "o botão foi esticado e ficou muito grande"). */}
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
