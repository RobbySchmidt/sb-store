-- ============================================================
-- Migration 003 — optional cancellation reason on orders
-- Run once in the Supabase SQL editor (already applied).
-- ============================================================

alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancel_note   text;
