// Painel de configuração do vídeo de vendas do Agente de IA — campo
// simples, um link só, dentro do painel admin unificado.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminGetAgenteIaSettings, adminSaveAgenteIaSettings } from "@/lib/admin-agente-ia.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AdminAgenteIaPanel() {
  const getSettings = useServerFn(adminGetAgenteIaSettings);
  const saveSettings = useServerFn(adminSaveAgenteIaSettings);

  const [videoUrl, setVideoUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettings()
      .then((data) => setVideoUrl(data.sales_video_url ?? ""))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {!loaded ? (
        <p className="text-sm text-neutral-500">Carregando...</p>
      ) : (
        <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="space-y-1.5">
            <Label>Link do vídeo</Label>
            <Input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
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
