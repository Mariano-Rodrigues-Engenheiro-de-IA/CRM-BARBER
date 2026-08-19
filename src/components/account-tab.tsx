// Aba "Minha conta" (Configurações): dados da barbearia que aparecem no
// sistema e na página pública de agendamento.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type Api = (path: string, opts?: RequestInit) => Promise<any>;

type Shop = {
  id: string;
  name: string;
  logo_url: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
};

/** Redimensiona a imagem escolhida (mantendo a proporção original, sem
 * cortar) e devolve um data URL leve — evita depender de um serviço externo
 * de upload de arquivos só pra guardar a logo. */
async function fileToLogoDataUrl(file: File, maxSize = 320): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não consegui processar a imagem");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

export function AccountTab({ api }: { api: Api }) {
  const [shop, setShop] = useState<Shop | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    api("/api/public/extension/shop").then((r) => {
      if (r?.ok) setShop(r.shop);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof Shop>(key: K, value: Shop[K]) {
    setShop((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleLogoFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Escolha um arquivo de imagem");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToLogoDataUrl(file);
      set("logo_url", dataUrl);
    } catch (e: any) {
      toast.error(e?.message || "Erro ao processar a imagem");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!shop) return;
    if (shop.name.trim().length < 2) {
      toast.error("Informe o nome da empresa");
      return;
    }
    setSaving(true);
    try {
      const r = await api("/api/public/extension/shop", {
        method: "PATCH",
        body: JSON.stringify({
          name: shop.name.trim(),
          logo_url: shop.logo_url?.trim() || null,
          owner_name: shop.owner_name?.trim() || null,
          owner_email: shop.owner_email?.trim() || null,
          owner_phone: shop.owner_phone?.trim() || null,
        }),
      });
      if (!r?.ok) throw new Error(r?.error || "Erro ao salvar");
      setShop(r.shop);
      toast.success("Dados atualizados");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  if (!shop) return <p className="text-sm text-neutral-500">Carregando...</p>;

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center gap-4">
        {shop.logo_url ? (
          <img src={shop.logo_url} alt={`Logo de ${shop.name}`} className="h-16 w-16 rounded-xl border border-neutral-200 object-contain bg-white" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-brand text-xl font-semibold text-white">
            {shop.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="flex-1 space-y-1.5">
          <Label>Logo da empresa</Label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? "Processando..." : shop.logo_url ? "Trocar arquivo" : "Escolher arquivo"}
            </Button>
            {shop.logo_url && (
              <Button type="button" variant="ghost" size="sm" onClick={() => set("logo_url", null)}>
                Remover
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Nome da empresa</Label>
        <Input value={shop.name} onChange={(e) => set("name", e.target.value)} />
        <p className="text-xs text-neutral-400">É esse nome que aparece no sistema e na página pública de agendamento.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Responsável</Label>
          <Input value={shop.owner_name ?? ""} onChange={(e) => set("owner_name", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Telefone</Label>
          <Input value={shop.owner_phone ?? ""} onChange={(e) => set("owner_phone", e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>E-mail</Label>
        <Input value={shop.owner_email ?? ""} onChange={(e) => set("owner_email", e.target.value)} />
      </div>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Salvando..." : "Salvar dados"}
      </Button>
    </div>
  );
}
