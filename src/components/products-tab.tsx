// Aba "Produtos" das configuracoes: cadastro simples e igual pra qualquer tipo
// de negocio (nome, valor, descricao, categoria).
//
// Antes esta aba era um catalogo complexo pra IA calcular orcamento (preco por
// tabela de faixa, formula por m2, roteiro de atendimento, palavras-chave,
// "sempre escalar pra equipe"), que ninguem usa. As colunas antigas continuam
// na tabela e nas rotas do servidor, so nao aparecem mais aqui.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { ConfigTable, type ConfigColumn } from "@/components/config-table";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

export type Product = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price: number | null;
  active: boolean;
};

export function ProductsTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const r = await api("/api/public/extension/products?include_inactive=1");
    if (r?.ok) setProducts(r.products);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(p: Product) {
    const r = await api(`/api/public/extension/products/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    });
    if (r?.ok) {
      await load();
      onChanged?.();
    }
  }

  const editing = products.find((p) => p.id === editingId) ?? null;

  const money = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const columns: ConfigColumn<Product>[] = [
    {
      key: "name",
      label: "Descrição",
      sortValue: (p) => p.name,
      render: (p) => (
        <div className="min-w-0">
          <p className={"font-medium " + (p.active ? "text-neutral-900" : "text-neutral-400")}>{p.name}</p>
          {p.description && <p className="max-w-xs truncate text-xs text-neutral-400">{p.description}</p>}
        </div>
      ),
    },
    {
      key: "category",
      label: "Categoria",
      sortValue: (p) => p.category,
      render: (p) => <span className="text-neutral-600">{p.category ?? "-"}</span>,
    },
    {
      key: "price",
      label: "Valor (R$)",
      align: "right",
      sortValue: (p) => p.price,
      render: (p) => <span className="tabular-nums">{p.price != null ? money(p.price) : "-"}</span>,
    },
    {
      key: "status",
      label: "Status",
      sortValue: (p) => (p.active ? 0 : 1),
      render: (p) => (
        <span
          className={
            "rounded-full px-2 py-0.5 text-[11px] font-semibold " +
            (p.active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500")
          }
        >
          {p.active ? "Ativo" : "Inativo"}
        </span>
      ),
    },
    {
      key: "actions",
      label: "Ações",
      align: "right",
      render: (p) => (
        <div className="flex justify-end gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingId(p.id);
              setFormOpen(true);
            }}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={p.active ? "text-red-600 hover:text-red-700" : "text-emerald-700 hover:text-emerald-800"}
            onClick={() => toggleActive(p)}
          >
            {p.active ? "Desativar" : "Reativar"}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <ConfigTable
        rows={products}
        columns={columns}
        rowKey={(p) => p.id}
        searchText={(p) => `${p.name} ${p.category ?? ""} ${p.description ?? ""}`}
        defaultSort={{ key: "name", dir: "asc" }}
        emptyMessage="Nenhum produto cadastrado ainda."
        rowClassName={(p) => (p.active ? "" : "opacity-70")}
        toolbar={
          <Button
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Novo produto
          </Button>
        }
      />

      <ProductFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        api={api}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />
    </>
  );
}

function ProductFormDialog({
  open,
  onOpenChange,
  editing,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Product | null;
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setPrice(editing?.price != null ? String(editing.price) : "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
    }
  }, [open, editing]);

  async function handleSave() {
    if (!name.trim()) return;
    // Aceita "12,50" e "12.50".
    const value = price.trim() === "" ? null : Number(price.trim().replace(",", "."));
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast.error("Valor inválido");
      return;
    }
    setSaving(true);
    try {
      const cat = category.trim();
      const desc = description.trim();
      const r = editing
        ? await api(`/api/public/extension/products/${editing.id}`, {
            method: "PATCH",
            // Na edicao, campo vazio limpa o que estava salvo.
            body: JSON.stringify({ name: name.trim(), price: value, category: cat || null, description: desc || null }),
          })
        : await api("/api/public/extension/products", {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              price: value ?? undefined,
              category: cat || undefined,
              description: desc || undefined,
            }),
          });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(editing ? "Produto atualizado" : "Produto adicionado");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do produto</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Pomada modeladora" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Valor (opcional)</Label>
              <Input
                inputMode="decimal"
                placeholder="R$"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria (opcional)</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: Cabelo" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            {saving ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
