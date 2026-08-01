-- Performance indexes for common SUPER_ADMIN / OWNER queries
-- Run this in Supabase SQL Editor

-- Ticket table indexes
CREATE INDEX IF NOT EXISTS idx_ticket_pawnshop_id ON public.ticket (pawnshop_id);
CREATE INDEX IF NOT EXISTS idx_ticket_lifecycle_status ON public.ticket (lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_ticket_status ON public.ticket (status);
CREATE INDEX IF NOT EXISTS idx_ticket_pawnshop_lifecycle ON public.ticket (pawnshop_id, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_ticket_pawnshop_status ON public.ticket (pawnshop_id, status);

-- Profile table indexes
CREATE INDEX IF NOT EXISTS idx_profiles_pawnshop_id ON public.profiles (pawnshop_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_pawnshop_role ON public.profiles (pawnshop_id, role);

-- Pawnshop table indexes
CREATE INDEX IF NOT EXISTS idx_pawnshops_status ON public.pawnshops (status);
CREATE INDEX IF NOT EXISTS idx_pawnshops_status_active ON public.pawnshops (status, is_active);

-- Loan table indexes
CREATE INDEX IF NOT EXISTS idx_loan_pawnshop_id ON public.loan (pawnshop_id);
CREATE INDEX IF NOT EXISTS idx_loan_status ON public.loan (status);
CREATE INDEX IF NOT EXISTS idx_loan_pawnshop_status ON public.loan (pawnshop_id, status);

-- Subscription table indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_pawnshop_id ON public.subscriptions (pawnshop_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions (status);
