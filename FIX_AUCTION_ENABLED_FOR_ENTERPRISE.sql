-- FIX: Pawnshops on PROFESSIONAL/ENTERPRISE subscriptions should have the
-- Auction House module enabled. Pawnshops created during a trial keep
-- auction_enabled:false in pawnshops.settings; upgrading the tier never flipped it.
-- Run this in the Supabase SQL editor. Safe to re-run.

-- 1) Enable auction_enabled for pawnshops whose LATEST subscription is a paid
--    tier that includes auction access. (pawnshops.settings and
--    subscriptions.features are `json` columns; pawnshops has no updated_at.)
UPDATE public.pawnshops p
SET settings = (jsonb_set(
      COALESCE(p.settings::jsonb, '{}'::jsonb),
      '{auction_enabled}',
      'true'::jsonb
    )::json)
WHERE EXISTS (
  SELECT 1
  FROM public.subscriptions s
  WHERE s.pawnshop_id = p.id
    AND s.tier IN ('PROFESSIONAL', 'ENTERPRISE')
    AND s.status IN ('ACTIVE', 'PAST_DUE')
  ORDER BY s.created_at DESC
  LIMIT 1
);

-- 2) Repair stale features JSON on those subscriptions (e.g. an Enterprise row
--    still carrying trial/BASIC features).
UPDATE public.subscriptions s
SET features = (jsonb_build_object(
      'pawn_ticketing', true,
      'loan_management', true,
      'basic_analytics', true,
      'advanced_analytics', true,
      'queue_management', true,
      'auction_access', true,
      'api_access', true,
      'priority_support', true,
      'custom_branding', true
    )::json),
    updated_at = NOW()
WHERE s.tier = 'ENTERPRISE'
  AND s.status IN ('ACTIVE', 'PAST_DUE')
  AND COALESCE((s.features->>'auction_access')::boolean, false) IS NOT TRUE;

UPDATE public.subscriptions s
SET features = (jsonb_build_object(
      'pawn_ticketing', true,
      'loan_management', true,
      'basic_analytics', true,
      'advanced_analytics', true,
      'queue_management', true,
      'auction_access', true,
      'api_access', true,
      'priority_support', true,
      'custom_branding', false
    )::json),
    updated_at = NOW()
WHERE s.tier = 'PROFESSIONAL'
  AND s.status IN ('ACTIVE', 'PAST_DUE')
  AND COALESCE((s.features->>'auction_access')::boolean, false) IS NOT TRUE;
