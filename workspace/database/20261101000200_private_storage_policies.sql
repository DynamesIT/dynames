-- DYNAMES Workspace Storage policies.
-- PREREQUISITO: creare dal dashboard/API Storage il bucket PRIVATO
-- ID = dynames-member-files, public=false, 10MB massimi,
-- MIME: image/jpeg, image/png, image/webp, application/pdf.
-- NON gestire storage.objects con INSERT/DELETE SQL: usare la Storage API.
begin;

-- Foto: <user-id>/photo/<uuid>.jpg|jpeg|png|webp
-- CV:   <user-id>/cv/<uuid>.pdf
-- Path: due cartelle + un solo filename; l'utente scrive solo nel proprio prefisso.
create policy dynames_storage_own_insert
on storage.objects for insert to authenticated with check (
  bucket_id = 'dynames-member-files'
  and (select private.has_profile())
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and array_length(storage.foldername(name),1) = 2
  and (
    ((storage.foldername(name))[2]='photo' and lower(storage.extension(name)) in ('jpg','jpeg','png','webp'))
    or ((storage.foldername(name))[2]='cv' and lower(storage.extension(name))='pdf')
  )
);

create policy dynames_storage_owner_admin_read
on storage.objects for select to authenticated using (
  bucket_id = 'dynames-member-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.is_super_admin())
  )
);

-- Aggiornare un file significa creare un nuovo oggetto e poi eliminare il vecchio.
-- NESSUNA policy UPDATE: impedisce overwrite/upsert diretto.
create policy dynames_storage_owner_delete
on storage.objects for delete to authenticated using (
  bucket_id = 'dynames-member-files'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select private.is_super_admin())
  )
);
commit;
