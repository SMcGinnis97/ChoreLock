-- (applied via MCP 2026-08-25)
-- Per-device (router-managed MAC) manual override and daily allowed window.
-- Enforced by the future LAN agent; chore lock state still applies when override is null.
alter table devices
  add column override lock_override,
  add column schedule_start time,
  add column schedule_end time;
