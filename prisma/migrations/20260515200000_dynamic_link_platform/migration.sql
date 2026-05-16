-- Migration: 20260515200000_dynamic_link_platform
--
-- Adds DYNAMIC_LINK to the RetailerPlatform enum.
--
-- DYNAMIC_LINK describes retailers like Bookshop.org whose listings are
-- generated on demand from a known URL template (e.g. ISBN deep-link)
-- rather than from a product feed or live API call.  No scraping, no feed,
-- no per-listing API cost — just ISBN → URL construction at upsert time,
-- with affiliate attribution applied at click time via /go/[id].
--
-- PostgreSQL enums can only ADD values (never remove/rename without a full
-- type rebuild), so we use the safe ADD VALUE approach.

ALTER TYPE "RetailerPlatform" ADD VALUE IF NOT EXISTS 'DYNAMIC_LINK';
