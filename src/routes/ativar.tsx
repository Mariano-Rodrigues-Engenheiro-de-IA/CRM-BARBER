import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/ativar")({
  head: () => ({
    meta: [
      { title: "Ativar extensão — CRM de Assinaturas" },
      {
        name: "description",
        content:
          "Cole o código de ativação recebido para parear sua extensão do CRM com a sua barbearia.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Activate,
});

type ActivateResponse =
  | { ok: true; token: string; barbershop: { id: string; name: string } }
  | { ok: false; error: string };

function Activate() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<
    { token: string; barbershop: { id: string; name: string } } | null
  >(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/public/extension/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), label: "Extensão Chrome" }),
      });
      const json = (await res.json()) as ActivateResponse;
      if (!json.ok) {
        toast.error(json.error);
        return;
      }
      setResult({ token: json.token, barbershop: json.barbershop });
      toast.success("Ativação concluída.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Ativar extensão</CardTitle>
          <CardDescription>
            Cole o código que você recebeu para conectar a extensão à sua barbearia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="space-y-4">
              <p className="text-sm">
                Extensão ativada para <strong>{result.barbershop.name}</strong>.
              </p>
              <div className="space-y-2">
                <Label>Token da extensão (guarde em local seguro)</Label>
                <textarea
                  readOnly
                  value={result.token}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  A extensão guarda esse token no próprio navegador. Ele não aparece de novo
                  — se perder, gere outro código de ativação.
                </p>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link to="/">Voltar</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="code">Código de ativação</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ex: ABC123-XYZ789"
                  autoComplete="off"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Ativando…" : "Ativar"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link to="/" className="underline underline-offset-4">
                  Voltar
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
