-- DYNAMES WORKSPACE · FASE 1 · Registro membri, candidature e controllo degli accessi.
-- PostgreSQL / Supabase. Eseguire in un progetto di prova, prima di qualunque ambiente reale.
-- NON eseguire più volte la stessa migrazione; usare il tracciamento migrazioni Supabase.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- 1. PROFILO AUTOCOMPILATO: solo dati professionali e contatti.
create table public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 120),
  last_name text not null check (length(btrim(last_name)) between 1 and 120),
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  phone text check (phone is null or length(phone) <= 50),
  organization text check (organization is null or length(organization) <= 200),
  professional_position text check (professional_position is null or length(professional_position) <= 200),
  biography text check (biography is null or length(biography) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. DOMANDE DI ADESIONE: stato modificabile solo dalla governance autorizzata.
create table public.member_applications (
  user_id uuid primary key references public.member_profiles(user_id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  privacy_notice_version text not null check (length(btrim(privacy_notice_version)) between 1 and 50),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  constraint review_consistency check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);
create index member_applications_status_idx on public.member_applications(status, submitted_at);

-- 3. ISCRITTI VALIDATI: account e membership sono concetti separati.
create table public.members (
  user_id uuid primary key references public.member_profiles(user_id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'ceased')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  constraint membership_dates check ((status = 'ceased') = (ended_at is not null))
);
create index members_status_idx on public.members(status);

-- 4. CATALOGO TEMATICHE (multiselezione).
create table public.topics (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  title text not null unique,
  display_order smallint not null unique check (display_order > 0)
);

insert into public.topics (slug, title, display_order) values
 ('difesa-sicurezza','Difesa e Sicurezza',1),
 ('diritto-legittimita','Diritto e Legittimità',2),
 ('governance-pubblica','Governance Pubblica',3),
 ('economia-industria','Economia e Industria',4),
 ('risorse-energie','Risorse ed Energie',5),
 ('tecnologia-sistemi-complessi','Tecnologia e Sistemi Complessi',6),
 ('informazione-dominio-cognitivo','Informazione e Dominio Cognitivo',7),
 ('societa-educazione','Società ed Educazione',8),
 ('infrastrutture-strategiche','Infrastrutture Strategiche',9),
 ('salute-welfare','Salute e Welfare',10);

create table public.member_topics (
  user_id uuid not null references public.member_profiles(user_id) on delete cascade,
  topic_slug text not null references public.topics(slug),
  primary key (user_id, topic_slug)
);
create index member_topics_topic_idx on public.member_topics(topic_slug);

-- 5. ATTIVITÀ A CUI IL MEMBRO DESIDERA CONTRIBUIRE (non sono incarichi).
create table public.contribution_areas (
  code text primary key,
  title text not null,
  display_order smallint not null unique
);
insert into public.contribution_areas values
 ('editoriale','Attività editoriale',1),
 ('scientifica','Attività scientifica',2),
 ('confronto','Eventi e gruppi di progetto',3),
 ('formazione','Formazione',4);
create table public.member_contributions (
  user_id uuid not null references public.member_profiles(user_id) on delete cascade,
  area_code text not null references public.contribution_areas(code),
  primary key (user_id, area_code)
);

-- 6. PRIVILEGI ASSEGNATI MANUALMENTE. La funzione organizzativa NON conferisce automaticamente permessi.
create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_code text not null check (role_code in
    ('super_admin','governance','function_lead','project_lead','member','observer')),
  scope_type text not null check (scope_type in ('global','function','project')),
  scope_id uuid,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint grant_scope_match check (
    (role_code in ('super_admin','governance','member','observer') and scope_type = 'global' and scope_id is null)
    or (role_code = 'function_lead' and scope_type = 'function' and scope_id is not null)
    or (role_code = 'project_lead' and scope_type = 'project' and scope_id is not null)
  ),
  constraint revocation_after_grant check (revoked_at is null or revoked_at >= granted_at)
);
create index access_grants_user_idx on public.access_grants(user_id) where revoked_at is null;
create unique index active_unique_grants_idx on public.access_grants
  (user_id,role_code,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

-- 7. METADATI DOCUMENTI (i byte NON sono salvati in PostgreSQL).
create table public.member_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.member_profiles(user_id) on delete cascade,
  document_kind text not null check (document_kind in ('photo','cv')),
  storage_path text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  mime_type text not null,
  size_bytes bigint not null,
  updated_at timestamptz not null default now(),
  unique (user_id,document_kind),
  constraint document_format_size check (
    (document_kind = 'photo' and mime_type in ('image/jpeg','image/png','image/webp') and size_bytes between 1 and 5242880)
    or (document_kind = 'cv' and mime_type = 'application/pdf' and size_bytes between 1 and 10485760)
  ),
  constraint document_storage_path check (
    split_part(storage_path,'/',1) = user_id::text
    and split_part(storage_path,'/',2) = document_kind
    and length(split_part(storage_path,'/',3)) > 0
    and split_part(storage_path,'/',4) = ''
  )
);
create index member_documents_user_idx on public.member_documents(user_id);

-- 8. AUDIT MINIMALE: evita dati personali / contenuto del CV nel log.
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  target_user_id uuid,
  resource_type text not null,
  resource_id text not null,
  action text not null,
  changes jsonb not null default '{}'::jsonb,
  logged_at timestamptz not null default now()
);
create index audit_log_target_idx on public.audit_log(target_user_id,logged_at desc);

-- 9. HELPERS: funzione definer in schema NON esposto via Data API.
create function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.access_grants g
    join public.members m on m.user_id = g.user_id and m.status = 'active'
    where g.user_id = (select auth.uid())
      and g.role_code = 'super_admin'
      and g.scope_type = 'global'
      and g.revoked_at is null
  );
$$;
create function private.has_profile()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.member_profiles p where p.user_id = (select auth.uid()));
$$;
create function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.member_profiles
  for each row execute function private.touch_updated_at();
create trigger documents_touch before update on public.member_documents
  for each row execute function private.touch_updated_at();

create function private.audit_admin_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  incoming jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  outgoing jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
begin
  insert into public.audit_log(actor_user_id,target_user_id,resource_type,resource_id,action,changes)
  values (
    auth.uid(),
    coalesce((incoming->>'user_id')::uuid,(outgoing->>'user_id')::uuid),
    tg_table_name,
    coalesce(incoming->>'id',outgoing->>'id',incoming->>'user_id',outgoing->>'user_id'),
    tg_op,
    pg_catalog.jsonb_build_object(
      'old_status',outgoing->>'status','new_status',incoming->>'status',
      'old_role',outgoing->>'role_code','new_role',incoming->>'role_code',
      'scope_type',coalesce(incoming->>'scope_type',outgoing->>'scope_type')
    )
  );
  return coalesce(new,old);
end;
$$;
create trigger applications_audit after insert or update or delete on public.member_applications
  for each row execute function private.audit_admin_change();
create trigger members_audit after insert or update or delete on public.members
  for each row execute function private.audit_admin_change();
create trigger access_grants_audit after insert or update or delete on public.access_grants
  for each row execute function private.audit_admin_change();

-- 10. REVIEW ATOMICA: SECURITY INVOKER, con controllo amministrativo e RLS.
create function public.review_application(p_user_id uuid,p_approve boolean)
returns text language plpgsql security invoker set search_path = '' as $$
declare current_status text;
begin
  if not (select private.is_super_admin()) then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  select status into current_status
  from public.member_applications
  where user_id=p_user_id for update;
  if not found or current_status <> 'pending' then
    raise exception 'Application not pending';
  end if;
  if p_approve then
    insert into public.members(user_id,status,approved_by)
      values (p_user_id,'active',auth.uid());
    insert into public.access_grants(user_id,role_code,scope_type,granted_by)
      values (p_user_id,'member','global',auth.uid());
  end if;
  update public.member_applications
     set status=case when p_approve then 'approved' else 'rejected' end,
         reviewed_at=now(), reviewed_by=auth.uid()
   where user_id=p_user_id;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

-- 11. Row-Level Security su OGNI tabella applicativa.
alter table public.member_profiles enable row level security;
alter table public.member_applications enable row level security;
alter table public.members enable row level security;
alter table public.topics enable row level security;
alter table public.member_topics enable row level security;
alter table public.contribution_areas enable row level security;
alter table public.member_contributions enable row level security;
alter table public.access_grants enable row level security;
alter table public.member_documents enable row level security;
alter table public.audit_log enable row level security;

-- Revoca permessi impliciti e concessione esplicita per colonna e azione.
revoke all on public.member_profiles,public.member_applications,public.members,
  public.topics,public.member_topics,public.contribution_areas,
  public.member_contributions,public.access_grants,public.member_documents,
  public.audit_log from anon, authenticated;

grant select on public.topics,public.contribution_areas to anon,authenticated;
grant select on public.member_profiles,public.member_applications,public.members,
  public.member_topics,public.member_contributions,public.access_grants,
  public.member_documents,public.audit_log to authenticated;
grant insert(user_id,first_name,last_name,contact_email,phone,organization,professional_position,biography)
  on public.member_profiles to authenticated;
grant update(first_name,last_name,contact_email,phone,organization,professional_position,biography)
  on public.member_profiles to authenticated;
grant insert(user_id,privacy_notice_version)
  on public.member_applications to authenticated;
grant update(status,reviewed_at,reviewed_by)
  on public.member_applications to authenticated;
grant insert,update(status,ended_at) on public.members to authenticated;
grant insert,delete on public.member_topics,public.member_contributions to authenticated;
grant insert,update(revoked_at) on public.access_grants to authenticated;
grant insert,delete on public.member_documents to authenticated;
grant update(storage_path,original_filename,mime_type,size_bytes)
  on public.member_documents to authenticated;

create policy profile_read on public.member_profiles for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy profile_create on public.member_profiles for insert to authenticated
  with check (user_id=(select auth.uid()));
create policy profile_edit on public.member_profiles for update to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()))
  with check (user_id=(select auth.uid()) or (select private.is_super_admin()));

create policy application_read on public.member_applications for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy application_submit on public.member_applications for insert to authenticated
  with check (user_id=(select auth.uid()) and status='pending');
create policy application_review on public.member_applications for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy member_read on public.members for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy member_add on public.members for insert to authenticated
  with check ((select private.is_super_admin()));
create policy member_edit on public.members for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy topic_list on public.topics for select to anon,authenticated using (true);
create policy contribution_list on public.contribution_areas for select to anon,authenticated using (true);

create policy member_topics_read on public.member_topics for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy member_topics_add on public.member_topics for insert to authenticated
  with check (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy member_topics_remove on public.member_topics for delete to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));

create policy contributions_read on public.member_contributions for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy contributions_add on public.member_contributions for insert to authenticated
  with check (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy contributions_remove on public.member_contributions for delete to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));

create policy grants_read on public.access_grants for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy grants_add on public.access_grants for insert to authenticated
  with check ((select private.is_super_admin()));
create policy grants_revoke on public.access_grants for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create policy documents_read on public.member_documents for select to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy documents_add on public.member_documents for insert to authenticated
  with check (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy documents_change on public.member_documents for update to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()))
  with check (user_id=(select auth.uid()) or (select private.is_super_admin()));
create policy documents_remove on public.member_documents for delete to authenticated
  using (user_id=(select auth.uid()) or (select private.is_super_admin()));

create policy audit_admin_read on public.audit_log for select to authenticated
  using ((select private.is_super_admin()));

-- Revoche funzione: mai disponibile ad anon/PUBLIC per errore.
revoke execute on function private.is_super_admin() from public,anon,authenticated;
revoke execute on function private.has_profile() from public,anon,authenticated;
revoke execute on function private.touch_updated_at() from public,anon,authenticated;
revoke execute on function private.audit_admin_change() from public,anon,authenticated;
revoke execute on function public.review_application(uuid,boolean) from public,anon,authenticated;
grant execute on function private.is_super_admin(),private.has_profile() to authenticated;
grant execute on function public.review_application(uuid,boolean) to authenticated;

commit;
