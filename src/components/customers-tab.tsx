import { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
export function CustomersTab({ api }: { api: Api }) {
  const [mode, setMode] = useState<"individual" | "bulk">("individual");

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
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

      {mode === "individual" ? <IndividualForm api={api} /> : <SpreadsheetImportWizard api={api} />}
    </div>
  );
}

function IndividualForm({ api }: { api: Api }) {
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
      toast.success("Cliente cadastrado");
      setName("");
      setPhone("");
      setEmail("");
      setBirthDate("");
      setAddress("");
      setNotes("");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cadastrar cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>Nome completo</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" />
        </div>
        <div className="space-y-1.5">
          <Label>Telefone (com DDD)</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail (opcional)</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" />
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
        {saving ? "Salvando..." : "Cadastrar cliente"}
      </Button>
    </div>
  );
}

type SheetRow = Record<string, any>;

/** Wizard de importação por planilha: 1) upload  2) mapear colunas
 * 3) conferir e confirmar — mesmo fluxo usado por sistemas como Trinks. */
function SpreadsheetImportWizard({ api }: { api: Api }) {
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
            Envie um arquivo <strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong> com seus clientes —
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
              {importing ? "Importando..." : `Importar ${rows.length} cliente(s)`}
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
