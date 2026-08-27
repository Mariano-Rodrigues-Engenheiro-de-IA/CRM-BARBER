import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

export type Professional = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  bio: string | null;
  commission_percent: number | null;
  color: string;
  avatar_url: string | null;
  active: boolean;
  appointment_count?: number;
};
export type Service = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  active: boolean;
  professional_ids?: string[];
};
export type Product = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  active: boolean;
  palavras_chave_positivas?: string[];
  palavras_chave_negativas?: string[];
  tipo_precificacao?: "fixo" | "tabela_faixa" | "formula_area";
  tabela_precos?: TabelaPrecos | null;
  formula_calculo?: FormulaCalculo | null;
  variaveis_obrigatorias?: string[];
  roteiro_atendimento?: { campo: string; pergunta: string }[] | null;
  pedido_minimo?: string | null;
  sempre_escalar_humano?: boolean;
  motivo_escalar?: string | null;
  link_catalogo?: string | null;
  mensagem_apresentacao?: string | null;
  observacoes_regras_especiais?: string | null;
};

type Faixa = { quantidade_min: number; quantidade_max: number; variacoes: { nome: string; valor: number }[] };
type TabelaPrecos = { faixas: { quantidade_min: number; quantidade_max: number; variacoes: Record<string, number> }[] };
type Adicional = { nome: string; valor: number; aplica_apenas_se?: string };
type FormulaCalculo = {
  valor_m2: number;
  pedido_minimo_valor?: number;
  sangra_cm?: number;
  adicionais?: Adicional[];
  regra_solda?: { aplica_se: string; valor_por_metro_linear_menor_medida: number };
};

/** Redimensiona a imagem escolhida pra um quadrado pequeno e devolve um
 * data URL leve — evita subir arquivo e mantém a foto junto do cadastro. */
async function fileToSquareDataUrl(file: File, size = 160): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar a imagem");
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Bolinha do profissional: foto quando existe, senão a cor de identificação. */
export function ProfessionalAvatar({ professional, size = 24 }: { professional: { name: string; color: string; avatar_url?: string | null }; size?: number }) {
  if (professional.avatar_url) {
    return (
      <img
        src={professional.avatar_url}
        alt={`Foto de ${professional.name}`}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, borderColor: professional.color, borderWidth: 2, borderStyle: "solid" }}
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
      style={{ width: size, height: size, backgroundColor: professional.color }}
    >
      {professional.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const COLORS = ["#7399D7", "#E8998D", "#8FB996", "#D7B26D", "#B589C4", "#6EC4D0"];

/** Aba de Profissionais — cadastro completo (nome, telefone, e-mail, bio,
 * comissão, cor de identificação na agenda). Standalone, reaproveitada
 * tanto na tela de Configurações quanto (via dialog) dentro da Agenda. */
export function ProfessionalsTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();

  async function load() {
    const r = await api("/api/public/extension/professionals?include_inactive=1");
    if (r?.ok) setProfessionals(r.professionals);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(p: Professional) {
    const r = await api(`/api/public/extension/professionals/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !p.active }),
    });
    if (r?.ok) {
      await load();
      onChanged?.();
    }
  }

  async function deleteProfessional(p: Professional) {
    const hasHistory = (p.appointment_count ?? 0) > 0;
    const ok = await confirm(
      hasHistory
        ? {
            title: "Este profissional possui agendamentos vinculados.",
            description: `Ao excluir ${p.name}, os ${p.appointment_count} agendamento${p.appointment_count === 1 ? "" : "s"} vinculados a ele também serão excluídos. Tem certeza de que deseja continuar?`,
            confirmLabel: "Excluir profissional",
            destructive: true,
          }
        : {
            title: `Tem certeza que deseja excluir ${p.name}?`,
            confirmLabel: "Excluir",
            destructive: true,
          },
    );
    if (!ok) return;
    const r = await api(`/api/public/extension/professionals/${p.id}`, { method: "DELETE" });
    if (!r?.ok) {
      toast.error(r?.error || "Erro ao excluir");
      return;
    }
    toast.success("Profissional excluído");
    await load();
    onChanged?.();
  }

  const editing = professionals.find((p) => p.id === editingId) ?? null;

  return (
    <div className="space-y-3">
      {confirmDialog}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Profissionais cadastrados</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
        >
          + Novo profissional
        </Button>
      </div>

      {professionals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          Nenhum profissional cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {professionals.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
              <ProfessionalAvatar professional={p} size={32} />
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm font-medium " + (p.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {p.name}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {[p.phone, p.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                  {p.commission_percent != null ? ` · Comissão ${p.commission_percent}%` : ""}
                </p>
                {p.bio && <p className="truncate text-[11px] text-brand">{p.bio}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(p.id);
                  setFormOpen(true);
                }}
              >
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
                {p.active ? "Desativar" : "Reativar"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-neutral-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => void deleteProfessional(p)}
                title="Excluir"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </Button>
            </div>
          ))}
        </div>
      )}

      <ProfessionalFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        nextColor={COLORS[professionals.length % COLORS.length]}
        api={api}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />
    </div>
  );
}

function ProfessionalFormDialog({
  open,
  onOpenChange,
  editing,
  nextColor,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Professional | null;
  nextColor: string;
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [commission, setCommission] = useState("");
  const [color, setColor] = useState(nextColor);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setPhone(editing?.phone ?? "");
      setEmail(editing?.email ?? "");
      setBio(editing?.bio ?? "");
      setCommission(editing?.commission_percent != null ? String(editing.commission_percent) : "");
      setColor(editing?.color ?? nextColor);
      setAvatarUrl(editing?.avatar_url ?? null);
    }
  }, [open, editing, nextColor]);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        bio: bio.trim() || undefined,
        commission_percent: commission ? Number(commission) : undefined,
        color,
        avatar_url: avatarUrl,
      };
      const r = editing
        ? await api(`/api/public/extension/professionals/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/public/extension/professionals", { method: "POST", body: JSON.stringify(payload) });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(editing ? "Profissional atualizado" : "Profissional adicionado");
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
          <DialogTitle>{editing ? "Editar profissional" : "Novo profissional"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do profissional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Telefone (opcional)</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex: 44991234567" />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail (opcional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Foto (opcional)</Label>
            <div className="flex items-center gap-3">
              <ProfessionalAvatar professional={{ name: name || "?", color, avatar_url: avatarUrl }} size={56} />
              <div className="flex gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  className="max-w-[220px]"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setAvatarUrl(await fileToSquareDataUrl(file));
                    } catch {
                      toast.error("Não consegui usar essa imagem.");
                    }
                  }}
                />
                {avatarUrl && (
                  <Button variant="outline" size="sm" onClick={() => setAvatarUrl(null)}>
                    Remover
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-neutral-400">A foto aparece na agenda no lugar da bolinha colorida.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Especialidades (opcional)</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={2} placeholder="Ex: especialista em degradê e barba" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Comissão % (opcional)</Label>
              <Input type="number" min={0} max={100} value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cor na agenda</Label>
              <div className="flex gap-1.5 pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={"h-7 w-7 rounded-full border-2 " + (color === c ? "border-neutral-900" : "border-transparent")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
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

/** Aba de Serviços — cadastro completo (nome, categoria, descrição,
 * duração, preço). */
export function ServicesTab({ api, onChanged }: { api: Api; onChanged?: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function load() {
    const [sr, pr] = await Promise.all([
      api("/api/public/extension/services?include_inactive=1"),
      api("/api/public/extension/professionals"),
    ]);
    if (sr?.ok) setServices(sr.services);
    if (pr?.ok) setProfessionals(pr.professionals);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleActive(s: Service) {
    const r = await api(`/api/public/extension/services/${s.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !s.active }),
    });
    if (r?.ok) {
      await load();
      onChanged?.();
    }
  }

  const editing = services.find((s) => s.id === editingId) ?? null;

  function professionalNames(ids?: string[]) {
    if (!ids || ids.length === 0) return "Todos os profissionais";
    return ids.map((id) => professionals.find((p) => p.id === id)?.name).filter(Boolean).join(", ") || "—";
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Serviços cadastrados</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
        >
          + Novo serviço
        </Button>
      </div>

      {services.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          Nenhum serviço cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {services.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm font-medium " + (s.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {s.name}
                  {s.category && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">{s.category}</span>}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {s.duration_minutes}min{s.price ? ` · R$ ${s.price.toFixed(2)}` : ""}
                  {s.description ? ` · ${s.description}` : ""}
                </p>
                {professionals.length > 0 && (
                  <p className="truncate text-[11px] text-brand">{professionalNames(s.professional_ids)}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(s.id);
                  setFormOpen(true);
                }}
              >
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(s)}>
                {s.active ? "Desativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ServiceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        professionals={professionals}
        api={api}
        onSaved={async () => {
          await load();
          onChanged?.();
        }}
      />
    </div>
  );
}

function ServiceFormDialog({
  open,
  onOpenChange,
  editing,
  professionals,
  api,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Service | null;
  professionals: Professional[];
  api: Api;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState("");
  const [selectedPros, setSelectedPros] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setCategory(editing?.category ?? "");
      setDescription(editing?.description ?? "");
      setDuration(editing?.duration_minutes ?? 30);
      setPrice(editing?.price != null ? String(editing.price) : "");
      setSelectedPros(editing?.professional_ids ?? []);
    }
  }, [open, editing]);

  function toggleProf(id: string) {
    setSelectedPros((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        duration_minutes: duration,
        price: price ? Number(price) : undefined,
        professional_ids: selectedPros,
      };
      const r = editing
        ? await api(`/api/public/extension/services/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/public/extension/services", { method: "POST", body: JSON.stringify(payload) });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      toast.success(editing ? "Serviço atualizado" : "Serviço adicionado");
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
          <DialogTitle>{editing ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nome do serviço</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Corte masculino" />
          </div>
          <div className="space-y-1.5">
            <Label>Categoria (opcional)</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: Cabelo, Barba, Combo" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Duração (min)</Label>
              <Input type="number" min={5} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>Preço (opcional)</Label>
              <Input type="number" min={0} step={0.01} placeholder="R$" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>
          {professionals.length > 0 && (
            <div className="space-y-1.5">
              <Label>Quem realiza esse serviço</Label>
              <p className="text-xs text-neutral-400">Deixe todos desmarcados para liberar pra qualquer profissional.</p>
              <div className="flex flex-wrap gap-2">
                {professionals.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProf(p.id)}
                    className={
                      "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs " +
                      (selectedPros.includes(p.id)
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-neutral-300 text-neutral-600 hover:bg-neutral-50")
                    }
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
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

/** Cadastro de produtos — mesmo padrão de Serviços, sem duração/agenda. */
/** Resumo curto do preço pra exibir na listagem — cobre os 3 tipos de
 * precificação, já que a lista antes só olhava pro campo "price" (usado
 * só no tipo fixo) e ficava em branco para tabela_faixa/formula_area,
 * dando a falsa impressão de "produto sem preço cadastrado". */
function priceSummary(p: Product): string | null {
  if (p.sempre_escalar_humano) return "Sempre escala para a equipe";
  if (p.tipo_precificacao === "formula_area" && p.formula_calculo?.valor_m2 != null) {
    return `R$ ${p.formula_calculo.valor_m2.toFixed(2)} / m²`;
  }
  if (p.tipo_precificacao === "tabela_faixa" && p.tabela_precos?.faixas?.length) {
    const valores = p.tabela_precos.faixas.flatMap((f) => Object.values(f.variacoes ?? {}));
    if (valores.length > 0) return `Tabela por faixa · a partir de R$ ${Math.min(...valores).toFixed(2)}`;
    return "Tabela por faixa";
  }
  if (p.price != null) return `R$ ${p.price.toFixed(2)}`;
  return null;
}

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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-700">Produtos cadastrados</h3>
        <Button
          size="sm"
          onClick={() => {
            setEditingId(null);
            setFormOpen(true);
          }}
        >
          + Novo produto
        </Button>
      </div>

      {products.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-400">
          Nenhum produto cadastrado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {products.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className={"truncate text-sm font-medium " + (p.active ? "text-neutral-900" : "text-neutral-400 line-through")}>
                  {p.name}
                  {p.category && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-500">{p.category}</span>}
                </p>
                {priceSummary(p) && <p className="truncate text-xs text-neutral-400">{priceSummary(p)}</p>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(p.id);
                  setFormOpen(true);
                }}
              >
                Editar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => toggleActive(p)}>
                {p.active ? "Desativar" : "Reativar"}
              </Button>
            </div>
          ))}
        </div>
      )}

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
    </div>
  );
}

/** Editor simples de lista de textos curtos (palavras-chave, variáveis
 * obrigatórias) — digita e aperta Enter pra adicionar, clica no X pra
 * remover. Sem edição de JSON bruto, pensado pra alguém não técnico usar. */
function TagListEditor({
  values,
  onChange,
  placeholder,
  badgeVariant = "secondary",
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  badgeVariant?: "secondary" | "destructive";
}) {
  const [draft, setDraft] = useState("");

  function addDraft() {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setDraft("");
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant={badgeVariant} className="gap-1 pr-1">
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="ml-0.5 rounded-full px-1 hover:bg-black/10"
            >
              ×
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addDraft();
          }
        }}
        onBlur={addDraft}
        placeholder={placeholder}
      />
    </div>
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
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // Identificação (usado por buscar_produto)
  const [palavrasPositivas, setPalavrasPositivas] = useState<string[]>([]);
  const [palavrasNegativas, setPalavrasNegativas] = useState<string[]>([]);

  // Precificação
  const [tipoPrecificacao, setTipoPrecificacao] = useState<"fixo" | "tabela_faixa" | "formula_area">("fixo");
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [valorM2, setValorM2] = useState("");
  const [pedidoMinimoValor, setPedidoMinimoValor] = useState("");
  const [sangraCm, setSangraCm] = useState("");
  const [adicionais, setAdicionais] = useState<Adicional[]>([]);
  const [soldaAtiva, setSoldaAtiva] = useState(false);
  const [soldaAplicaSe, setSoldaAplicaSe] = useState("largura > 1.75 E altura > 1.75");
  const [soldaValor, setSoldaValor] = useState("");

  // Coleta e escalonamento
  const [variaveisObrigatorias, setVariaveisObrigatorias] = useState<string[]>([]);
  const [roteiro, setRoteiro] = useState<{ campo: string; pergunta: string }[]>([]);
  const [pedidoMinimo, setPedidoMinimo] = useState("");
  const [sempreEscalarHumano, setSempreEscalarHumano] = useState(false);
  const [motivoEscalar, setMotivoEscalar] = useState("");
  const [linkCatalogo, setLinkCatalogo] = useState("");
  const [mensagemApresentacao, setMensagemApresentacao] = useState("");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setPrice(editing?.price != null ? String(editing.price) : "");
    setPalavrasPositivas(editing?.palavras_chave_positivas ?? []);
    setPalavrasNegativas(editing?.palavras_chave_negativas ?? []);
    setTipoPrecificacao(editing?.tipo_precificacao ?? "fixo");

    const tabela = editing?.tabela_precos;
    setFaixas(
      (tabela?.faixas ?? []).map((f) => ({
        quantidade_min: f.quantidade_min,
        quantidade_max: f.quantidade_max,
        variacoes: Object.entries(f.variacoes ?? {}).map(([nome, valor]) => ({ nome, valor })),
      })),
    );

    const formula = editing?.formula_calculo;
    setValorM2(formula?.valor_m2 != null ? String(formula.valor_m2) : "");
    setPedidoMinimoValor(formula?.pedido_minimo_valor != null ? String(formula.pedido_minimo_valor) : "");
    setSangraCm(formula?.sangra_cm != null ? String(formula.sangra_cm) : "");
    setAdicionais(formula?.adicionais ?? []);
    setSoldaAtiva(!!formula?.regra_solda);
    setSoldaAplicaSe(formula?.regra_solda?.aplica_se ?? "largura > 1.75 E altura > 1.75");
    setSoldaValor(formula?.regra_solda?.valor_por_metro_linear_menor_medida != null
      ? String(formula.regra_solda.valor_por_metro_linear_menor_medida)
      : "");

    setVariaveisObrigatorias(editing?.variaveis_obrigatorias ?? []);
    setRoteiro(editing?.roteiro_atendimento ?? []);
    setPedidoMinimo(editing?.pedido_minimo ?? "");
    setSempreEscalarHumano(editing?.sempre_escalar_humano ?? false);
    setMotivoEscalar(editing?.motivo_escalar ?? "");
    setLinkCatalogo(editing?.link_catalogo ?? "");
    setMensagemApresentacao(editing?.mensagem_apresentacao ?? "");
    setObservacoes(editing?.observacoes_regras_especiais ?? "");
  }, [open, editing]);

  function addFaixa() {
    setFaixas((prev) => [...prev, { quantidade_min: 0, quantidade_max: 0, variacoes: [{ nome: "padrao", valor: 0 }] }]);
  }
  function addAdicional() {
    setAdicionais((prev) => [...prev, { nome: "", valor: 0, aplica_apenas_se: "" }]);
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        category: category.trim() || undefined,
        price: price ? Number(price) : undefined,
        palavras_chave_positivas: palavrasPositivas,
        palavras_chave_negativas: palavrasNegativas,
        tipo_precificacao: tipoPrecificacao,
        variaveis_obrigatorias: variaveisObrigatorias,
        roteiro_atendimento: roteiro.filter((r) => r.campo.trim() && r.pergunta.trim()).length > 0
          ? roteiro.filter((r) => r.campo.trim() && r.pergunta.trim())
          : null,
        pedido_minimo: pedidoMinimo.trim() || null,
        sempre_escalar_humano: sempreEscalarHumano,
        motivo_escalar: sempreEscalarHumano ? motivoEscalar.trim() || null : null,
        link_catalogo: linkCatalogo.trim() || null,
        mensagem_apresentacao: mensagemApresentacao.trim() || null,
        observacoes_regras_especiais: observacoes.trim() || null,
      };

      if (tipoPrecificacao === "tabela_faixa") {
        payload.tabela_precos = {
          faixas: faixas.map((f) => ({
            quantidade_min: f.quantidade_min,
            quantidade_max: f.quantidade_max,
            variacoes: Object.fromEntries(f.variacoes.filter((v) => v.nome.trim()).map((v) => [v.nome.trim(), v.valor])),
          })),
        };
        payload.formula_calculo = null;
      } else if (tipoPrecificacao === "formula_area") {
        payload.formula_calculo = {
          valor_m2: Number(valorM2) || 0,
          pedido_minimo_valor: pedidoMinimoValor ? Number(pedidoMinimoValor) : undefined,
          sangra_cm: sangraCm ? Number(sangraCm) : undefined,
          adicionais: adicionais.filter((a) => a.nome.trim()).map((a) => ({
            nome: a.nome.trim(),
            valor: a.valor,
            aplica_apenas_se: a.aplica_apenas_se?.trim() || undefined,
          })),
          regra_solda: soldaAtiva
            ? { aplica_se: soldaAplicaSe.trim(), valor_por_metro_linear_menor_medida: Number(soldaValor) || 0 }
            : undefined,
        };
        payload.tabela_precos = null;
      } else {
        payload.tabela_precos = null;
        payload.formula_calculo = null;
      }

      const r = editing
        ? await api(`/api/public/extension/products/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await api("/api/public/extension/products", { method: "POST", body: JSON.stringify(payload) });
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
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="basico" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basico">Básico</TabsTrigger>
            <TabsTrigger value="identificacao">Identificação</TabsTrigger>
            <TabsTrigger value="preco">Preço</TabsTrigger>
            <TabsTrigger value="regras">Regras</TabsTrigger>
          </TabsList>

          <TabsContent value="basico" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label>Nome do produto</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Banner com acabamento em madeira" />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria (opcional)</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex: Comunicação Visual, Papelaria" />
            </div>
            <div className="space-y-1.5">
              <Label>Link do catálogo do WhatsApp (opcional)</Label>
              <Input value={linkCatalogo} onChange={(e) => setLinkCatalogo(e.target.value)} placeholder="https://wa.me/p/..." />
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem de apresentação (opcional)</Label>
              <Textarea
                value={mensagemApresentacao}
                onChange={(e) => setMensagemApresentacao(e.target.value)}
                placeholder="Frase que a IA usa ao identificar interesse nesse produto. Deixe em branco para usar uma genérica."
                rows={2}
              />
            </div>
          </TabsContent>

          <TabsContent value="identificacao" className="space-y-4 pt-3">
            <p className="text-xs text-neutral-500">
              Essas palavras ajudam a IA a reconhecer quando o cliente está pedindo este produto, e a não confundir com produtos parecidos.
            </p>
            <div className="space-y-1.5">
              <Label>Palavras-chave (sinônimos que o cliente usaria)</Label>
              <TagListEditor values={palavrasPositivas} onChange={setPalavrasPositivas} placeholder="Digite e aperte Enter (ex: banner, faixa promocional)" />
            </div>
            <div className="space-y-1.5">
              <Label>Palavras que NÃO são este produto (evita confusão com produto parecido)</Label>
              <TagListEditor
                values={palavrasNegativas}
                onChange={setPalavrasNegativas}
                placeholder="Digite e aperte Enter (ex: interditado, prefeitura, placa)"
                badgeVariant="destructive"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Dados que a IA precisa perguntar ao cliente antes de calcular</Label>
              <TagListEditor values={variaveisObrigatorias} onChange={setVariaveisObrigatorias} placeholder="Digite e aperte Enter (ex: tamanho, quantidade, tipo_impressao)" />
            </div>

            <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
              <div>
                <Label>Roteiro de atendimento (opcional, mas recomendado)</Label>
                <p className="text-xs text-neutral-500">
                  Defina a ordem exata das perguntas e o texto exato que a IA deve usar para este produto. Se deixar vazio, a IA formula a pergunta sozinha a partir da lista acima.
                </p>
              </div>
              {roteiro.map((passo, pi) => (
                <div key={pi} className="flex items-start gap-2">
                  <span className="mt-2 text-xs font-semibold text-neutral-400">{pi + 1}.</span>
                  <div className="flex-1 space-y-1">
                    <Input
                      placeholder="Campo (ex: largura_m)"
                      value={passo.campo}
                      onChange={(e) => setRoteiro((prev) => prev.map((p, i) => (i === pi ? { ...p, campo: e.target.value } : p)))}
                    />
                    <Textarea
                      rows={2}
                      placeholder="Pergunta exata (ex: Qual a largura, em metros?)"
                      value={passo.pergunta}
                      onChange={(e) => setRoteiro((prev) => prev.map((p, i) => (i === pi ? { ...p, pergunta: e.target.value } : p)))}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setRoteiro((prev) => prev.filter((_, i) => i !== pi))}
                    className="mt-2 text-neutral-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setRoteiro((prev) => [...prev, { campo: "", pergunta: "" }])}>
                + Adicionar passo do roteiro
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="preco" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label>Como esse produto é precificado</Label>
              <Select value={tipoPrecificacao} onValueChange={(v) => setTipoPrecificacao(v as typeof tipoPrecificacao)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixo">Preço fixo por unidade</SelectItem>
                  <SelectItem value="tabela_faixa">Tabela por faixa de quantidade</SelectItem>
                  <SelectItem value="formula_area">Fórmula por área (largura × altura)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {tipoPrecificacao === "fixo" && (
              <div className="space-y-1.5">
                <Label>Preço unitário</Label>
                <Input type="number" min={0} step={0.01} placeholder="R$" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            )}

            {tipoPrecificacao === "tabela_faixa" && (
              <div className="space-y-3">
                {faixas.map((faixa, fi) => (
                  <div key={fi} className="space-y-2 rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-500">Faixa {fi + 1}</span>
                      <button
                        type="button"
                        onClick={() => setFaixas((prev) => prev.filter((_, i) => i !== fi))}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Remover faixa
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Quantidade mínima</Label>
                        <Input
                          type="number"
                          value={faixa.quantidade_min}
                          onChange={(e) =>
                            setFaixas((prev) => prev.map((f, i) => (i === fi ? { ...f, quantidade_min: Number(e.target.value) } : f)))
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Quantidade máxima</Label>
                        <Input
                          type="number"
                          value={faixa.quantidade_max}
                          onChange={(e) =>
                            setFaixas((prev) => prev.map((f, i) => (i === fi ? { ...f, quantidade_max: Number(e.target.value) } : f)))
                          }
                        />
                      </div>
                    </div>
                    <Label className="text-xs">Variações e valores (ex: 4x0, 4x1, 4x4 — ou "padrao" se só tiver um valor)</Label>
                    {faixa.variacoes.map((v, vi) => (
                      <div key={vi} className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          placeholder="Nome (ex: 4x0)"
                          value={v.nome}
                          onChange={(e) =>
                            setFaixas((prev) =>
                              prev.map((f, i) =>
                                i === fi ? { ...f, variacoes: f.variacoes.map((vv, vvi) => (vvi === vi ? { ...vv, nome: e.target.value } : vv)) } : f,
                              ),
                            )
                          }
                        />
                        <Input
                          className="w-28"
                          type="number"
                          step={0.01}
                          placeholder="R$"
                          value={v.valor}
                          onChange={(e) =>
                            setFaixas((prev) =>
                              prev.map((f, i) =>
                                i === fi
                                  ? { ...f, variacoes: f.variacoes.map((vv, vvi) => (vvi === vi ? { ...vv, valor: Number(e.target.value) } : vv)) }
                                  : f,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setFaixas((prev) => prev.map((f, i) => (i === fi ? { ...f, variacoes: f.variacoes.filter((_, vvi) => vvi !== vi) } : f)))
                          }
                          className="text-neutral-400 hover:text-red-600"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setFaixas((prev) => prev.map((f, i) => (i === fi ? { ...f, variacoes: [...f.variacoes, { nome: "", valor: 0 }] } : f)))
                      }
                      className="text-xs text-brand hover:underline"
                    >
                      + adicionar variação
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addFaixa}>
                  + Adicionar faixa de quantidade
                </Button>
              </div>
            )}

            {tipoPrecificacao === "formula_area" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Valor por m²</Label>
                    <Input type="number" step={0.01} placeholder="R$" value={valorM2} onChange={(e) => setValorM2(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Pedido mínimo (R$, opcional)</Label>
                    <Input type="number" step={0.01} placeholder="R$" value={pedidoMinimoValor} onChange={(e) => setPedidoMinimoValor(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Sangra em cm (opcional, só pra peças pequenas)</Label>
                  <Input type="number" step={0.1} placeholder="Ex: 0.2" value={sangraCm} onChange={(e) => setSangraCm(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Adicionais condicionais (ex: ilhós só se acabamento for madeira)</Label>
                  {adicionais.map((ad, ai) => (
                    <div key={ai} className="flex items-center gap-2">
                      <Input
                        className="flex-1"
                        placeholder="Nome (ex: ilhos_4_pontas)"
                        value={ad.nome}
                        onChange={(e) => setAdicionais((prev) => prev.map((a, i) => (i === ai ? { ...a, nome: e.target.value } : a)))}
                      />
                      <Input
                        className="w-24"
                        type="number"
                        step={0.01}
                        placeholder="R$"
                        value={ad.valor}
                        onChange={(e) => setAdicionais((prev) => prev.map((a, i) => (i === ai ? { ...a, valor: Number(e.target.value) } : a)))}
                      />
                      <Input
                        className="flex-1"
                        placeholder='Condição (ex: acabamento = madeira)'
                        value={ad.aplica_apenas_se ?? ""}
                        onChange={(e) => setAdicionais((prev) => prev.map((a, i) => (i === ai ? { ...a, aplica_apenas_se: e.target.value } : a)))}
                      />
                      <button
                        type="button"
                        onClick={() => setAdicionais((prev) => prev.filter((_, i) => i !== ai))}
                        className="text-neutral-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addAdicional}>
                    + Adicionar adicional
                  </Button>
                </div>

                <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center justify-between">
                    <Label>Regra de solda (peças grandes)</Label>
                    <Switch checked={soldaAtiva} onCheckedChange={setSoldaAtiva} />
                  </div>
                  {soldaAtiva && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Quando aplica</Label>
                        <Input value={soldaAplicaSe} onChange={(e) => setSoldaAplicaSe(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Valor por metro linear (da menor medida)</Label>
                        <Input type="number" step={0.01} placeholder="R$" value={soldaValor} onChange={(e) => setSoldaValor(e.target.value)} />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="regras" className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <Label>Pedido mínimo (texto livre, opcional)</Label>
              <Input value={pedidoMinimo} onChange={(e) => setPedidoMinimo(e.target.value)} placeholder="Ex: 10 unidades" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 p-3">
              <div>
                <Label>Sempre escalar para atendente humano</Label>
                <p className="text-xs text-neutral-500">A IA nunca calcula nem informa preço deste produto sozinha.</p>
              </div>
              <Switch checked={sempreEscalarHumano} onCheckedChange={setSempreEscalarHumano} />
            </div>
            {sempreEscalarHumano && (
              <div className="space-y-1.5">
                <Label>Motivo (a IA explica isso ao cliente com suas próprias palavras)</Label>
                <Textarea
                  value={motivoEscalar}
                  onChange={(e) => setMotivoEscalar(e.target.value)}
                  placeholder="Ex: preço varia muito conforme material e local de aplicação, sem tabela fixa"
                  rows={2}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Observações e regras especiais (opcional)</Label>
              <Textarea
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Qualquer regra que não se encaixe nos campos acima"
                rows={3}
              />
            </div>
          </TabsContent>
        </Tabs>

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


/** Dialog com as duas abas juntas — atalho rápido a partir da Agenda. */
export function ProfessionalsServicesDialog({
  open,
  onOpenChange,
  api,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: Api;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"professionals" | "services">("professionals");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Profissionais e serviços</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="w-full">
            <TabsTrigger value="professionals" className="flex-1">
              Profissionais
            </TabsTrigger>
            <TabsTrigger value="services" className="flex-1">
              Serviços
            </TabsTrigger>
          </TabsList>
          <TabsContent value="professionals" className="max-h-[50vh] overflow-y-auto">
            <ProfessionalsTab api={api} onChanged={onChanged} />
          </TabsContent>
          <TabsContent value="services" className="max-h-[50vh] overflow-y-auto">
            <ServicesTab api={api} onChanged={onChanged} />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
