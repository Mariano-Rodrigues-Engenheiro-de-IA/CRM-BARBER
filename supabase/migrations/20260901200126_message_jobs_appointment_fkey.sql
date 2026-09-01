-- A migração anterior (20260901183916) adicionou message_jobs.appointment_id
-- sem chave estrangeira — funcionava pra gravar, mas o PostgREST precisa
-- da FK de verdade pra resolver o join implícito message_jobs ->
-- appointments (usado na confirmação por texto digitado, pra saber se o
-- agendamento já foi confirmado antes de tentar confirmar de novo).

ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_appointment_id_fkey
    FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS message_jobs_appointment_id_idx
  ON public.message_jobs (appointment_id)
  WHERE appointment_id IS NOT NULL;
