import { useEffect, useState } from "react";
import { isClinicNiche } from "@/lib/business-niche";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

const SYSTEM_FIELDS = [
  { value: "name", label: "Nome", required: true },
  { value: "phone", label: "Telefone", required: true },
  { value: "email", label: "E-mail" },
  { value: "birth_date", label: "Data de nascimento" },
  { value: "address", label: "Endereço" },
  { value: "notes", label: "Observações" },
  { value: "__ignore__", label: "Não importar" },
];

/** Aba "Clientes" — cadastro individual completo, ou em massa via upload
 * de planilha (.xlsx/.xls/.csv) com mapeamento de colunas — mesmo padrão
 * usado por sistemas profissionais como Trinks (upload → mapear colunas →
 * conferir → confirmar). */
export function CustomersTab({ api, businessType }: { api: Api; businessType?: string }) {
  const [mode, setMode] = useState<"list" | "individual" | "bulk">("list");
  const noun = isClinicNiche(businessType) ? "paciente" : "cliente";

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("list")}
          className={
            "rounded-lg px-3 py-1.5 text-sm font-medium " +
            (mode === "list" ? "bg-brand text-white" : "border border-neutral-300 text-neutral-600")
          }
        >
          Ver {noun}s
        </button>
        <button
          onClick={() => setMode("individual")}
          className={
            "rounded-lg px-3 py-1.5 text-sm font-medium " +
            (mode === "individual" ? "bg-brand text-white" : "border border-neutral-300 text-neutral-600")
          }
        >
          Cadastro individual
        </button>
        <button
          onClick={() => setMode("bulk")}
          className={
            "rounded-lg px-3 py-1.5 text-sm font-medium " +
            (mode === "bulk" ? "bg-brand text-white" : "border border-neutral-300 text-neutral-600")
          }
        >
          Importar planilha
        </button>
      </div>

      {mode === "list" && <CustomerListView api={api} businessType={businessType} />}
      {mode === "individual" && <IndividualForm api={api} businessType={businessType} />}
      {mode === "bulk" && <SpreadsheetImportWizard api={api} businessType={businessType} />}
    </div>
  );
}

type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  birth_date: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  archived_at: string | null;
};

/** Listagem de clientes já cadastrados — busca por nome/telefone, edição
 * via dialog. */
function CustomerListView({ api, businessType }: { api: Api; businessType?: string }) {
  const noun = isClinicNiche(businessType) ? "paciente" : "cliente";
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const r = await api("/api/public/extension/customers");
    if (r?.ok) setCustomers(r.customers);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (customers ?? []).filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.includes(q);
  });

  // Volta pra página 1 sempre que a busca ou o tamanho de página mudar.
  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Exclui um ou vários clientes. A API arquiva (soft delete) cada um,
   * então mandamos uma chamada por cliente e só recarregamos no fim. */
  async function deleteMany(ids: string[]) {
    if (ids.length === 0) return;
    const msg =
      ids.length === 1
        ? `Excluir esse ${noun}?`
        : `Excluir ${ids.length} ${noun}(s) selecionado(s)?`;
    if (!confirm(msg)) return;
    setDeleting(true);
    try {
      const results = await Promise.all(
        ids.map((id) => api(`/api/public/extension/customers/${id}`, { method: "DELETE" }).catch(() => null)),
      );
      const failed = results.filter((r) => !r?.ok).length;
      if (failed > 0) toast.error(`${failed} ${noun}(s) não puderam ser excluídos.`);
      else toast.success(ids.length === 1 ? `${noun[0].toUpperCase()}${noun.slice(1)} excluído` : `${ids.length} ${noun}s excluídos`);
      setSelected(new Set());
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allPageSelected = pageItems.length > 0 && pageItems.every((c) => selected.has(c.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou telefone..."
          className="max-w-sm"
        />
        <div className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span>Mostrar</span>
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
              <SelectItem value="200">200</SelectItem>
            </SelectContent>
          </Select>
          <span>por página</span>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-500">{selected.size} selecionado(s)</span>
            <Button variant="outline" size="sm" className="h-8 text-red-600" disabled={deleting} onClick={() => deleteMany([...selected])}>
              {deleting ? "Excluindo..." : "Excluir selecionados"}
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          </div>
        )}
        {filtered.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs text-red-600"
            disabled={deleting}
            onClick={() => deleteMany(filtered.map((c) => c.id))}
          >
            Excluir todos os {filtered.length} listados
          </Button>
        )}
      </div>

      {!customers ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          {customers.length === 0 ? `Nenhum ${noun} cadastrado ainda.` : `Nenhum ${noun} encontrado com essa busca.`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos desta página"
                    checked={allPageSelected}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const c of pageItems) {
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">Telefone</th>
                <th className="px-3 py-2 font-medium">E-mail</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pageItems.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${c.name}`}
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-neutral-900">{c.name}</td>
                  <td className="px-3 py-2 text-neutral-600">{c.phone}</td>
                  <td className="px-3 py-2 text-neutral-500">{c.email || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600" disabled={deleting} onClick={() => deleteMany([c.id])}>
                      Excluir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-400">
            <span>
              {filtered.length} {noun}(s){search ? ` (de ${customers.length} no total)` : ""} · página {currentPage} de{" "}
              {totalPages}
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={currentPage <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </div>
      )}

      <CustomerEditDialog
        customer={editing}
        onOpenChange={(v) => !v && setEditing(null)}
        api={api}
        businessType={businessType}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </div>
  );
}

function CustomerEditDialog({
  customer,
  onOpenChange,
  api,
  businessType,
  onSaved,
}: {
  customer: Customer | null;
  onOpenChange: (v: boolean) => void;
  api: Api;
  businessType?: string;
  onSaved: () => void;
}) {
  const noun = isClinicNiche(businessType) ? "paciente" : "cliente";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone);
      setEmail(customer.email ?? "");
      setBirthDate(customer.birth_date ?? "");
      setAddress(customer.address ?? "");
      setNotes(customer.notes ?? "");
    }
  }, [customer]);

  async function handleSave() {
    if (!customer || !name.trim() || !phone.trim()) return;
    setSaving(true);
    try {
      const r = await api(`/api/public/extension/customers/${customer.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          birth_date: birthDate || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} atualizado`);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar {noun}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Telefone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Data de nascimento</Label>
            <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Endereço</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Observações</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !phone.trim() || saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IndividualForm({ api, businessType }: { api: Api; businessType?: string }) {
  const noun = isClinicNiche(businessType) ? "paciente" : "cliente";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    try {
      const r = await api("/api/public/extension/customers", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || undefined,
          birth_date: birthDate || undefined,
          address: address.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao cadastrar");
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} cadastrado`);
      setName("");
      setPhone("");
      setEmail("");
      setBirthDate("");
      setAddress("");
      setNotes("");
    } catch (e: any) {
      toast.error(e?.message || `Erro ao cadastrar ${noun}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Nome completo</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Nome do ${noun}`} />
        </div>
        <div className="space-y-1.5">
          <Label>Telefone (com DDD)</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail (opcional)</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`${noun}@email.com`} />
        </div>
        <div className="space-y-1.5">
          <Label>Data de nascimento (opcional)</Label>
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Endereço (opcional)</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Observações (opcional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <Button onClick={handleSave} disabled={!name.trim() || !phone.trim() || saving}>
        {saving ? "Salvando..." : `Cadastrar ${noun}`}
      </Button>
    </div>
  );
}

type SheetRow = Record<string, any>;

/** Wizard de importação por planilha: 1) upload  2) mapear colunas
 * 3) conferir e confirmar — mesmo fluxo usado por sistemas como Trinks. */
function SpreadsheetImportWizard({ api, businessType }: { api: Api; businessType?: string }) {
  const noun = isClinicNiche(businessType) ? "paciente" : "cliente";
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "binary" });
        const firstSheet = wb.SheetNames[0];
        const sheet = wb.Sheets[firstSheet];
        const json = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "" });
        if (json.length === 0) {
          toast.error("A planilha está vazia.");
          return;
        }
        const detectedHeaders = Object.keys(json[0]);
        setHeaders(detectedHeaders);
        setRows(json);
        // Tenta pré-mapear automaticamente por nome de coluna parecido.
        const auto: Record<string, string> = {};
        for (const h of detectedHeaders) {
          const norm = h.trim().toLowerCase();
          if (["nome", "name", "cliente"].includes(norm)) auto[h] = "name";
          else if (["telefone", "phone", "celular", "whatsapp"].includes(norm)) auto[h] = "phone";
          else if (["email", "e-mail"].includes(norm)) auto[h] = "email";
          else if (["nascimento", "data de nascimento", "birth_date", "aniversario", "aniversário"].includes(norm)) auto[h] = "birth_date";
          else if (["endereco", "endereço", "address"].includes(norm)) auto[h] = "address";
          else if (["observacoes", "observações", "notas", "notes"].includes(norm)) auto[h] = "notes";
          else auto[h] = "__ignore__";
        }
        setMapping(auto);
        setStep(2);
      } catch {
        toast.error("Não consegui ler esse arquivo. Confira se é um .xlsx, .xls ou .csv válido.");
      }
    };
    reader.onerror = () => toast.error("Erro ao ler o arquivo.");
    reader.readAsBinaryString(file);
  }

  const mappedName = Object.entries(mapping).find(([, v]) => v === "name")?.[0];
  const mappedPhone = Object.entries(mapping).find(([, v]) => v === "phone")?.[0];
  const canProceed = Boolean(mappedName && mappedPhone);

  const preview = rows.slice(0, 5).map((r) => {
    const out: Record<string, string> = {};
    for (const [col, field] of Object.entries(mapping)) {
      if (field !== "__ignore__") out[field] = String(r[col] ?? "");
    }
    return out;
  });

  async function handleImport() {
    setImporting(true);
    setResultMsg(null);
    try {
      const customers = rows
        .map((r) => {
          const out: Record<string, string> = {};
          for (const [col, field] of Object.entries(mapping)) {
            if (field !== "__ignore__") out[field] = String(r[col] ?? "").trim();
          }
          return out;
        })
        .filter((c) => c.name && c.phone);

      if (customers.length === 0) {
        toast.error("Nenhuma linha válida (nome + telefone) encontrada.");
        setImporting(false);
        return;
      }

      const r = await api("/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers, mode: "merge", source: "spreadsheet" }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao importar");
      setResultMsg(`Importação concluída: ${r.inserted} novo(s), ${r.updated} atualizado(s).`);
      setStep(3);
      toast.success("Importação concluída");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao importar clientes");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setStep(1);
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setResultMsg(null);
  }

  return (
    <div className="max-w-2xl space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      {/* Indicador de passos */}
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span className={step >= 1 ? "font-semibold text-brand" : ""}>1. Enviar arquivo</span>
        <span>→</span>
        <span className={step >= 2 ? "font-semibold text-brand" : ""}>2. Mapear colunas</span>
        <span>→</span>
        <span className={step >= 3 ? "font-semibold text-brand" : ""}>3. Concluído</span>
      </div>

      {step === 1 && (
        <div className="rounded-lg border-2 border-dashed border-neutral-300 p-8 text-center">
          <p className="mb-3 text-sm text-neutral-500">
            Envie um arquivo <strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong> com seus {noun}s.
            pode exportar direto do Excel ou Google Planilhas.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            id="customer-file-input"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <Button onClick={() => document.getElementById("customer-file-input")?.click()}>Escolher arquivo</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Arquivo: <strong>{fileName}</strong> · {rows.length} linha(s) encontrada(s)
          </p>
          <p className="text-xs text-neutral-500">
            Diz pra gente o que cada coluna da sua planilha representa. <strong>Nome</strong> e <strong>Telefone</strong> são
            obrigatórios.
          </p>
          <div className="space-y-2">
            {headers.map((h) => (
              <div key={h} className="flex items-center gap-3">
                <span className="w-40 truncate text-sm font-medium text-neutral-700" title={h}>
                  {h}
                </span>
                <span className="text-neutral-300">→</span>
                <Select value={mapping[h] ?? "__ignore__"} onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v }))}>
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SYSTEM_FIELDS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          {!canProceed && <p className="text-xs text-red-500">Mapeie pelo menos as colunas de Nome e Telefone pra continuar.</p>}

          {canProceed && preview.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-neutral-200">
              <table className="w-full text-xs">
                <thead className="bg-neutral-50 text-left uppercase tracking-wide text-neutral-500">
                  <tr>
                    {Object.keys(preview[0]).map((k) => (
                      <th key={k} className="px-3 py-2 font-medium">
                        {SYSTEM_FIELDS.find((f) => f.value === k)?.label ?? k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {preview.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-3 py-2 text-neutral-700">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-400">
                Mostrando as {preview.length} primeiras de {rows.length} linhas.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={!canProceed || importing}>
              {importing ? "Importando..." : `Importar ${rows.length} ${noun}(s)`}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3 text-center">
          <p className="text-sm font-medium text-emerald-600">{resultMsg}</p>
          <Button variant="outline" onClick={reset}>
            Importar outra planilha
          </Button>
        </div>
      )}
    </div>
  );
}
