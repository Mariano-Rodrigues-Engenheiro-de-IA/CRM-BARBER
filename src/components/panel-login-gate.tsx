// Portão de login do painel (e-mail + senha via Supabase Auth), liberado por
// barbearia: so aparece quando barbershops.login_required = true. Para as
// demais, confere o status uma vez por aba e libera direto.
//
// Fluxo: (1) pergunta ao servidor se essa barbearia exige login; (2) se sim e
// nao ha sessao salva, mostra "Entrar / Criar conta"; (3) com sessao, o
// servidor confere se esse login e o dono da barbearia (ou faz a primeira
// vinculacao, provada pelo token da extensao).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/painel-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Phase = "checking" | "form" | "verifying" | "denied";

export function PanelLoginGate({ token, onAuthed }: { token: string; onAuthed: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function verify(accessToken: string) {
    setPhase("verifying");
    const r = await api(token, "/api/public/extension/panel-auth", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (r?.ok) {
      onAuthed();
      return;
    }
    setError((r?.error as string) || "Não foi possível liberar o acesso agora.");
    setPhase("denied");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const st = await api(token, "/api/public/extension/panel-auth");
      if (cancelled) return;
      // Se a checagem falhar (rede, extensao fora do ar), NAO trava a barbearia
      // de fora do painel - segue como antes e registra o aviso. Enquanto o
      // login so vale pra contas de teste, disponibilidade importa mais.
      if (!st?.ok) {
        console.warn("[panel-login] falha ao checar login_required:", st?.error);
        onAuthed();
        return;
      }
      if (!st.login_required) {
        onAuthed();
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await verify(data.session.access_token);
      else setPhase("form");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const mail = email.trim();
    if (!mail || password.length < 8) {
      setError("Informe o e-mail e uma senha de pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "criar") {
        const { data, error: err } = await supabase.auth.signUp({
          email: mail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/email-confirmado` },
        });
        if (err) {
          setError(err.message.includes("already") ? "Esse e-mail já tem conta. Use \"Entrar\"." : err.message);
          return;
        }
        if (data.session) {
          await verify(data.session.access_token);
        } else {
          setInfo(
            "Enviamos um link de confirmação pro seu e-mail. Depois de confirmar, volte aqui e clique em Entrar.",
          );
          setMode("entrar");
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email: mail, password });
        if (err) {
          setError(
            err.message.includes("Invalid login")
              ? "E-mail ou senha incorretos."
              : err.message.includes("not confirmed")
                ? "Confirme seu e-mail primeiro (o link foi enviado quando você criou a conta)."
                : err.message,
          );
          return;
        }
        await verify(data.session.access_token);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setError(null);
    setPhase("form");
  }

  if (phase === "checking" || phase === "verifying") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
      </div>
    );
  }

  if (phase === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-neutral-900">Acesso não liberado</h1>
          <p className="mt-2 text-sm text-neutral-600">{error}</p>
          <Button className="mt-5 w-full" variant="outline" onClick={handleSignOut}>
            Entrar com outro e-mail
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">
            {mode === "entrar" ? "Entre no seu CRM" : "Crie seu acesso"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {mode === "entrar"
              ? "Use o e-mail e a senha que você cadastrou."
              : "Cadastre um e-mail e uma senha. Você só faz isso uma vez."}
          </p>
        </div>

        {info && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{info}</p>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="pl-email">E-mail</Label>
          <Input
            id="pl-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-pass">Senha</Label>
          <Input
            id="pl-pass"
            type="password"
            autoComplete={mode === "entrar" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Aguarde..." : mode === "entrar" ? "Entrar" : "Criar conta"}
        </Button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "entrar" ? "criar" : "entrar");
            setError(null);
            setInfo(null);
          }}
          className="w-full text-center text-sm text-neutral-500 underline hover:text-neutral-700"
        >
          {mode === "entrar" ? "Primeira vez? Criar conta" : "Já tenho conta. Entrar"}
        </button>
      </form>
    </div>
  );
}
