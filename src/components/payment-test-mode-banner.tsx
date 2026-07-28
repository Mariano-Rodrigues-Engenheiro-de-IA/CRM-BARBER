const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        Pagamentos em produção ainda não configurados.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-600">
        Ambiente de teste — nenhum pagamento real é cobrado nesta pré-visualização.
      </div>
    );
  }
  return null;
}
