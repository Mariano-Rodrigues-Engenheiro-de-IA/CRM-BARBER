import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

/** Aba "Clientes" — cadastro individual completo, ou em massa colando uma
 * lista (uma linha por cliente: nome, telefone). */
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
          Cadastro em massa
        </button>
      </div>

      {mode === "individual" ? <IndividualForm api={api} /> : <BulkForm api={api} />}
    </div>
  );
}

function IndividualForm({ api }: { api: Api }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !phone.trim()) return;
    setSaving(true);
    try {
      const r = await api("/api/public/extension/customers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), notes: notes.trim() || undefined }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao cadastrar");
      toast.success("Cliente cadastrado");
      setName("");
      setPhone("");
      setNotes("");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao cadastrar cliente");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-neutral-200 p-4">
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" />
      </div>
      <div className="space-y-1.5">
        <Label>Telefone (com DDD)</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
      </div>
      <div className="space-y-1.5">
        <Label>Notas (opcional)</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
      <Button onClick={handleSave} disabled={!name.trim() || !phone.trim() || saving}>
        {saving ? "Salvando..." : "Cadastrar cliente"}
      </Button>
    </div>
  );
}

function BulkForm({ api }: { api: Api }) {
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Reconhece linhas "Nome, Telefone" ou "Nome; Telefone" ou separadas por
  // tab (colar direto de planilha) — tolerante a formatos comuns.
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((p) => p.trim());
      return { name: parts[0] ?? "", phone: parts[1] ?? "" };
    })
    .filter((r) => r.name && r.phone);

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);
    setResult(null);
    try {
      const r = await api("/api/public/extension/customers/import", {
        method: "POST",
        body: JSON.stringify({ customers: rows, mode: "merge", source: "manual" }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao importar");
      setResult(`${rows.length} cliente(s) importado(s) com sucesso.`);
      setText("");
      toast.success("Importação concluída");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao importar clientes");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-3 rounded-lg border border-neutral-200 p-4">
      <p className="text-xs text-neutral-500">
        Cola uma lista, uma linha por cliente, no formato <code className="rounded bg-neutral-100 px-1">Nome, Telefone</code>{" "}
        — também aceita colar direto de uma planilha (Excel/Google Sheets).
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"João Silva, 44991234567\nMaria Souza, 44998887766"}
        className="font-mono text-xs"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">{rows.length} cliente(s) reconhecido(s)</span>
        <Button onClick={handleImport} disabled={rows.length === 0 || importing}>
          {importing ? "Importando..." : `Importar ${rows.length || ""}`}
        </Button>
      </div>
      {result && <p className="text-xs text-emerald-600">{result}</p>}
    </div>
  );
}
