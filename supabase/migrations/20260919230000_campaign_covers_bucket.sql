-- Bucket de Storage para as capas das campanhas (upload real pelo
-- admin, não link) — mesmo padrão de training-covers.
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-covers', 'campaign-covers', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read campaign-covers" ON storage.objects FOR SELECT
  USING (bucket_id = 'campaign-covers');
CREATE POLICY "authenticated upload campaign-covers" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-covers');
CREATE POLICY "authenticated update campaign-covers" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'campaign-covers');
CREATE POLICY "authenticated delete campaign-covers" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campaign-covers');
