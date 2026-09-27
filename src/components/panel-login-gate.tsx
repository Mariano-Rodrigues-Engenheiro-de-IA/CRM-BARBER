// Portao de login do painel (e-mail + senha via Supabase Auth), liberado por
// barbearia: so aparece quando barbershops.login_required = true. Para as
// demais, confere o status uma vez por aba e libera direto.
//
// Todo cliente ja tem a barbearia e o e-mail desde o checkout, entao nao ha
// "criar conta": na primeira vez a pessoa so DEFINE A SENHA do e-mail que ja
// esta cadastrado; depois, so entra com ela. O token da extensao (que prova o
// controle do WhatsApp) e o que autoriza definir a senha.

import { useEffect, useState } from "react";
import { getPanelAuth } from "@/lib/panel-auth-client";
import { api } from "@/lib/painel-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Phase = "checking" | "setpw" | "login" | "verifying" | "denied";

/** Logo da Zaylo no topo das telas de login. O arquivo tem margem propria
 * em volta, entao a altura visivel e menor que a do elemento. */
function LoginLogo() {
  return <img src="/brand/zaylo-logo.png" alt="Zaylo CRM" className="mx-auto -mb-1 h-14 w-auto object-contain" />;
}

export function PanelLoginGate({ token, onAuthed }: { token: string; onAuthed: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [knownEmail, setKnownEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function verify(accessToken: string) {
    setPhase("verifying");
    const r = await api(token, "/api/public/extension/panel-auth", {
      method: "POST",
      body: JSON.stringify({ action: "verify", access_token: accessToken }),
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
      // de fora do painel: segue como antes e registra o aviso. Enquanto o
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
      const mail = (st.owner_email as string | null) ?? null;
      setKnownEmail(mail);
      if (mail) setEmail(mail);
      const { data } = await getPanelAuth().getSession();
      if (cancelled) return;
      if (data.session) {
        await verify(data.session.access_token);
      } else {
        setPhase(st.has_owner ? "login" : "setpw");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInAndVerify(mail: string, pass: string) {
    const { data, error: err } = await getPanelAuth().signInWithPassword({ email: mail, password: pass });
    if (err || !data.session) {
      setError(err?.message?.includes("Invalid login") ? "E-mail ou senha incorretos." : err?.message || "Não foi possível entrar.");
      setPhase("login");
      return;
    }
    await verify(data.session.access_token);
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!knownEmail && !email.trim()) {
      setError("Informe o seu e-mail.");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As duas senhas não são iguais.");
      return;
    }
    setBusy(true);
    try {
      const r = await api(token, "/api/public/extension/panel-auth", {
        method: "POST",
        body: JSON.stringify({ action: "set_password", password, email: email.trim() }),
      });
      if (r?.ok) {
        await signInAndVerify(((r.email as string) || email).trim(), password);
        return;
      }
      if (r?.code === "email_exists" || r?.code === "has_owner") {
        // Esse e-mail ja tinha login (ou a senha ja foi definida): segue pro Entrar.
        setInfo(r.error as string);
        setConfirm("");
        setPhase("login");
        return;
      }
      setError((r?.error as string) || "Não foi possível definir a senha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Informe o e-mail e a senha.");
      return;
    }
    setBusy(true);
    try {
      await signInAndVerify(email.trim(), password);
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await getPanelAuth().signOut();
    setError(null);
    setPassword("");
    setPhase("login");
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
          <LoginLogo />
          <h1 className="mt-2 text-lg font-semibold text-neutral-900">Acesso não liberado</h1>
          <p className="mt-2 text-sm text-neutral-600">{error}</p>
          <Button className="mt-5 w-full" variant="outline" onClick={handleSignOut}>
            Entrar de novo
          </Button>
        </div>
      </div>
    );
  }

  const isSet = phase === "setpw";

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <form
        onSubmit={isSet ? handleSetPassword : handleLogin}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <LoginLogo />
        <div className="text-center">
          <h1 className="text-xl font-semibold text-neutral-900">
            {isSet ? "Defina sua senha" : "Entre no seu CRM"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {isSet
              ? "Você só faz isso uma vez. Depois é só entrar com essa senha."
              : "Use o e-mail e a senha que você definiu."}
          </p>
        </div>

        {info && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{info}</p>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="pl-email">E-mail</Label>
          <Input
            id="pl-email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly={Boolean(knownEmail)}
            className={knownEmail ? "bg-neutral-50 text-neutral-600" : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pl-pass">{isSet ? "Nova senha" : "Senha"}</Label>
          <Input
            id="pl-pass"
            type="password"
            autoComplete={isSet ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {isSet && (
          <div className="space-y-1.5">
            <Label htmlFor="pl-confirm">Repita a senha</Label>
            <Input
              id="pl-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Aguarde..." : isSet ? "Definir senha e entrar" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
