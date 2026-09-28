// Tabela padrao das abas de cadastro das configuracoes (Produtos, Servicos,
// Profissionais...), no estilo dos sistemas de barbearia/salao (AppBarber,
// Trinks): botao de novo no topo, busca, "resultados por pagina", colunas
// ordenaveis, listras nas linhas, contador "Mostrando de X ate Y de Z" e
// paginacao. Cada aba so descreve suas colunas; o resto e daqui.

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ConfigColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Se definido, a coluna e ordenavel por este valor (null vai sempre pro fim). */
  sortValue?: (row: T) => string | number | null;
  render: (row: T) => ReactNode;
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: ConfigColumn<T>[];
  rowKey: (row: T) => string;
  /** Texto usado pela busca (sem acento e sem diferenciar maiuscula). */
  searchText: (row: T) => string;
  /** Botao(oes) do canto superior esquerdo, ex: "Novo produto". */
  toolbar?: ReactNode;
  emptyMessage: string;
  rowClassName?: (row: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  pageSizes?: number[];
};

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { sensitivity: "base", numeric: true });
}

export function ConfigTable<T>({
  rows,
  columns,
  rowKey,
  searchText,
  toolbar,
  emptyMessage,
  rowClassName,
  defaultSort,
  pageSizes = [10, 25, 50],
}: Props<T>) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return q ? rows.filter((r) => normalize(searchText(r)).includes(q)) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search]);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : null;
    if (!sort || !col?.sortValue) return filtered;
    const get = col.sortValue;
    return [...filtered].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
      const c = compareValues(a, b);
      return sort.dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const startIdx = (current - 1) * pageSize;
  const pageRows = sorted.slice(startIdx, startIdx + pageSize);

  function toggleSort(key: string) {
    setPage(1);
    setSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  const pageNumbers = useMemo(() => {
    const end = Math.min(totalPages, Math.max(1, current - 2) + 4);
    const start = Math.max(1, end - 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [current, totalPages]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">{toolbar}</div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Pesquisar"
            className="pl-8"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          {emptyMessage}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <span>Mostrar</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span>resultados por página</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  {columns.map((c) => {
                    const sortable = Boolean(c.sortValue);
                    const active = sort?.key === c.key;
                    const Icon = !active ? ArrowUpDown : sort?.dir === "asc" ? ArrowUp : ArrowDown;
                    return (
                      <th
                        key={c.key}
                        className={
                          "px-3 py-2.5 font-semibold text-neutral-800 " +
                          (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left") +
                          (c.className ? " " + c.className : "")
                        }
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(c.key)}
                            className="inline-flex items-center gap-1 hover:text-neutral-950"
                          >
                            {c.label}
                            <Icon className={"h-3.5 w-3.5 " + (active ? "text-neutral-800" : "text-neutral-300")} />
                          </button>
                        ) : (
                          c.label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-8 text-center text-neutral-400">
                      Nenhum resultado para a busca.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => (
                    <tr
                      key={rowKey(row)}
                      className={
                        "border-b border-neutral-100 last:border-0 odd:bg-white even:bg-neutral-50/60 " +
                        (rowClassName?.(row) ?? "")
                      }
                    >
                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            "px-3 py-2.5 align-middle " +
                            (c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left") +
                            (c.className ? " " + c.className : "")
                          }
                        >
                          {c.render(row)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-600">
              {total === 0
                ? "Nenhum registro"
                : `Mostrando de ${startIdx + 1} até ${Math.min(startIdx + pageSize, total)} de ${total} registros`}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={current === 1} onClick={() => setPage(current - 1)}>
                  Anterior
                </Button>
                {pageNumbers.map((n) => (
                  <Button
                    key={n}
                    size="sm"
                    variant={n === current ? "default" : "outline"}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={current === totalPages}
                  onClick={() => setPage(current + 1)}
                >
                  Próximo
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
