-- Parents could not see any chore proof photos (reported 2026-09-13 on build #23).
-- Kids upload to `f/<kid_id>/<date>/<chore>-<attempt>.jpg` — the kid identity has no
-- family id, so store.live's `${identity.familyId ?? 'f'}` fallback always produced 'f'.
-- parent_read_proofs only accepted `<family_id>/...`, so createSignedUrl returned nothing
-- for parents on all 45 proofs uploaded since 2026-08-28 (kids could still see their own).
-- Accept both layouts: the family-prefixed one, and f/<kid> when that kid is in my family.
-- (The client now also resolves the kid's family id so new uploads use the family prefix.)

drop policy if exists parent_read_proofs on storage.objects;
create policy parent_read_proofs on storage.objects for select using (
  bucket_id = 'proofs' and (
    (storage.foldername(name))[1] = my_family_id()::text
    or (
      (storage.foldername(name))[1] = 'f'
      -- CASE guarantees the cast only runs on a uuid-shaped segment.
      and (case when (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then kid_family_id(((storage.foldername(name))[2])::uuid) end) = my_family_id()
    )
  )
);
