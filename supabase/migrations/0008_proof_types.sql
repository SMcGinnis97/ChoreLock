-- (applied via MCP 2026-08-25)
-- Chore proof requirements: photo, <=10s video, or both. Videos get their own column
-- (previously stored in photo_path by extension).
create type proof_type as enum ('photo','video','photo_video');
alter table chores add column proof_type proof_type not null default 'photo';
alter table chore_instances add column video_path text;
update chore_instances set video_path = photo_path, photo_path = null
  where photo_path ~ '\.(mp4|webm)$';
