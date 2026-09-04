-- Só necessária se você já rodou a migração original de dental_procedures
-- (com tooth_number singular) antes dessa correção. Se ainda não rodou
-- nada, ignora esse arquivo — a migração já corrigida
-- (20260904141852_dental_procedures.sql) já cria a coluna certa direto.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dental_procedures' AND column_name = 'tooth_number'
  ) THEN
    ALTER TABLE public.dental_procedures
      ADD COLUMN IF NOT EXISTS tooth_numbers integer[] NOT NULL DEFAULT '{}';
    UPDATE public.dental_procedures
      SET tooth_numbers = CASE WHEN tooth_number IS NULL THEN '{}'::integer[] ELSE ARRAY[tooth_number] END
      WHERE tooth_numbers = '{}';
    ALTER TABLE public.dental_procedures DROP COLUMN tooth_number;
  END IF;
END $$;
