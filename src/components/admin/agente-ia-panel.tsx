// Painel de configuração do vídeo de vendas do Agente de IA — campo
// simples, um link só, dentro do painel admin unificado.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetAgenteIaSettings, adminSaveAgenteIaSettings } from "@/lib/admin-agente-ia.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCachedFetch } from "@/lib/api-cache";

export function AdminAgenteIaPanel() {
  const getSettings = useServerFn(adminGetAgenteIaSettings);
  const saveSettings = useServerFn(adminSaveAgenteIaSettings);

  const { data: settings, loading } = useCachedFetch("admin-agente-ia-settings", () => getSettings());
  const [videoUrl, setVideoUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza o campo com o valor vindo do cache/servidor, mas só antes
  // do usuário começar a digitar — evita sobrescrever o que ele já editou.
  useEffect(() => {
    if (settings && !touched) setVideoUrl(settings.sales_video_url ?? "");
  }, [settings, touched]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveSettings({ data: { sales_video_url: videoUrl.trim() } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Vídeo do Agente de IA</h1>
        <p className="text-sm text-neutral-500">
          Link do YouTube mostrado na página de vendas do Agente de IA, antes do formulário de demonstração.
        </p>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="space-y-1.5">
            <Label>Link do vídeo</Label>
            <Input
              value={videoUrl}
              onChange={(e) => { setVideoUrl(e.target.value); setTouched(true); }}
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar"}
          </Button>
        </div>
      )}
    </div>
  );
}
