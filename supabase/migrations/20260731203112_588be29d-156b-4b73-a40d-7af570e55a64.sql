insert into public.shop_subscriptions
  (barbershop_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status, current_period_start, current_period_end, cancel_at_period_end, environment)
values
  ('3d9dc380-9341-4d4d-8874-e32e2643ae36', 'manual_comp_3d9dc380', 'manual_comp_3d9dc380', 'crm_premium', 'crm_premium_monthly', 'active', now(), '2030-01-01T00:00:00Z', false, 'live')
on conflict do nothing;