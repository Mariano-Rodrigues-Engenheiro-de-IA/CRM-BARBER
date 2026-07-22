import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app")({
  head: () => ({
    meta: [
      { title: "Painel — CRM de Assinaturas" },
      {
        name: "description",
        content: "Selecione sua barbearia e gerencie clientes, campanhas e disparos.",
      },
    ],
  }),
  component: AppHome,
});

type Barbershop = { id: string; name: string; created_at: string };

function AppHome() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const shopsQuery = useQuery({
    queryKey: ["barbershops"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("barbershops")
        .select("id, name, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Barbershop[];
    },
  });

  const [name, setName] = useState("");
  const createShop = useMutation({
    mutationFn: async (shopName: string) => {
      const { data, error } = await supabase
        .from("barbershops")
        .insert({ name: shopName, created_by: user.id })
        .select("id, name, created_at")
        .single();
      if (error) throw error;
      return data as Barbershop;
    },
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["barbershops"] });
      toast.success("Barbearia criada.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  useEffect(() => {
    // no-op placeholder for future onboarding flow
  }, []);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <h1 className="text-lg font-semibold">CRM de Assinaturas</h1>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
            <Button variant="outline" size="sm" onClick={signOut}>
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <section>
          <h2 className="text-xl font-semibold">Suas barbearias</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada barbearia é isolada — dados, clientes, campanhas e tokens da extensão nunca
            vazam entre elas.
          </p>

          <div className="mt-4">
            {shopsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : shopsQuery.error ? (
              <p className="text-sm text-destructive">
                {(shopsQuery.error as Error).message}
              </p>
            ) : shopsQuery.data && shopsQuery.data.length > 0 ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {shopsQuery.data.map((s) => (
                  <li key={s.id}>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">{s.name}</CardTitle>
                        <CardDescription className="text-xs">
                          Criada em {new Date(s.created_at).toLocaleDateString("pt-BR")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button variant="secondary" size="sm" disabled>
                          Abrir (em breve)
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Você ainda não tem nenhuma barbearia. Crie a primeira abaixo.
              </p>
            )}
          </div>
        </section>

        <section>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nova barbearia</CardTitle>
              <CardDescription>
                Você será cadastrado automaticamente como owner.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  createShop.mutate(name.trim());
                }}
              >
                <div className="flex-1 space-y-2">
                  <Label htmlFor="shop-name">Nome</Label>
                  <Input
                    id="shop-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Barbearia do Zé"
                    required
                  />
                </div>
                <Button type="submit" disabled={createShop.isPending}>
                  {createShop.isPending ? "Criando…" : "Criar"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
