-- Fabric: database schema for Supabase.
-- Run once on a new project: Supabase dashboard -> SQL Editor -> paste -> Run.
--
-- Security model
--   * Row-level security is on for every table. The public "anon" key in config.js
--     can only do what the policies and functions below allow.
--   * Patients read and edit only their own row.
--   * Clinics never read the patients table. They get a patient's data only through
--     get_consented_packet(), and only after that patient approves, for 24 hours,
--     limited to the sections the patient ticked.
--   * Shared links are 244-bit random tokens. They expire after 24 hours and the
--     patient can end them early.
--   * Every clinic view and link open is written to access_log, which the patient sees.
--
-- Demo only: this schema is not HIPAA-ready. Do not store real health information.

-- ---------------------------------------------------------------- helpers
create or replace function public.share_keys() returns text[]
language sql immutable set search_path = '' as $$
  select array['insurance','allergies','medications','conditions','immunizations','records','intake']
$$;

-- ---------------------------------------------------------------- patients
create table public.patients (
  id         uuid primary key references auth.users (id) on delete cascade,
  fabric_id  text not null unique,
  full_name  text not null check (char_length(full_name) between 1 and 120),
  dob        date,
  health     jsonb not null default '{}'::jsonb check (pg_column_size(health) < 200000),
  created_at timestamptz not null default now()
);

-- Fabric IDs look like FAB-7Q2K-91. Runs as owner so it can check every row for clashes.
create or replace function public.new_fabric_id() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := 'FAB-';
    for i in 1..4 loop
      candidate := candidate || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    candidate := candidate || '-' || lpad(floor(random() * 100)::int::text, 2, '0');
    exit when not exists (select 1 from public.patients where fabric_id = candidate);
  end loop;
  return candidate;
end $$;

alter table public.patients alter column fabric_id set default public.new_fabric_id();
alter table public.patients enable row level security;

create policy "read own patient row"   on public.patients for select to authenticated using (id = (select auth.uid()));
create policy "create own patient row" on public.patients for insert to authenticated with check (id = (select auth.uid()));
create policy "update own patient row" on public.patients for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Column grants: nobody can choose or change their own Fabric ID.
revoke all on public.patients from anon, authenticated;
grant select on public.patients to authenticated;
grant insert (id, full_name, dob, health) on public.patients to authenticated;
grant update (full_name, dob, health)     on public.patients to authenticated;

-- ---------------------------------------------------------------- clinics
create table public.clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create table public.clinic_members (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null default 'front_desk',
  primary key (clinic_id, user_id)
);
alter table public.clinics enable row level security;
alter table public.clinic_members enable row level security;

create or replace function public.is_clinic_member(p_clinic uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clinic_members where clinic_id = p_clinic and user_id = auth.uid())
$$;

create policy "members read their clinic" on public.clinics for select to authenticated using (public.is_clinic_member(id));
create policy "read own memberships" on public.clinic_members for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.clinics, public.clinic_members from anon, authenticated;
grant select on public.clinics, public.clinic_members to authenticated;

-- The demo clinic everyone can join from the clinic portal.
insert into public.clinics (id, name) values ('7b0e7a52-0000-4000-8000-000000000001', 'Riverside Family Practice');

-- ---------------------------------------------------------------- consent requests
create table public.consent_requests (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  clinic_name  text not null,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  items        text[] not null default '{}',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  expires_at   timestamptz
);
create index on public.consent_requests (patient_id, status);
create index on public.consent_requests (requested_by, created_at);
alter table public.consent_requests enable row level security;

create policy "patient reads own requests" on public.consent_requests for select to authenticated using (patient_id = (select auth.uid()));
create policy "clinic reads its requests"  on public.consent_requests for select to authenticated using (public.is_clinic_member(clinic_id));

-- No direct writes: everything goes through the functions below.
revoke all on public.consent_requests from anon, authenticated;
grant select on public.consent_requests to authenticated;

-- ---------------------------------------------------------------- shared links
create table public.share_links (
  token      text primary key default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  patient_id uuid not null default auth.uid() references public.patients (id) on delete cascade,
  items      text[] not null check (cardinality(items) > 0 and items <@ public.share_keys()),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  revoked    boolean not null default false
);
alter table public.share_links enable row level security;

create policy "patient reads own links"   on public.share_links for select to authenticated using (patient_id = (select auth.uid()));
create policy "patient creates own links" on public.share_links for insert to authenticated with check (patient_id = (select auth.uid()));
create policy "patient ends own links"    on public.share_links for update to authenticated
  using (patient_id = (select auth.uid())) with check (patient_id = (select auth.uid()));

revoke all on public.share_links from anon, authenticated;
grant select on public.share_links to authenticated;
grant insert (items) on public.share_links to authenticated;
grant update (revoked) on public.share_links to authenticated;

-- ---------------------------------------------------------------- access log
create table public.access_log (
  id         bigint generated always as identity primary key,
  patient_id uuid not null references public.patients (id) on delete cascade,
  actor      text not null,
  detail     text not null,
  at         timestamptz not null default now()
);
create index on public.access_log (patient_id, at desc);
alter table public.access_log enable row level security;
create policy "patient reads own log" on public.access_log for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.access_log from anon, authenticated;
grant select on public.access_log to authenticated;

-- ---------------------------------------------------------------- functions
-- Builds what a clinic may see: identity, plus only the sections the patient approved.
create or replace function public._packet(p_patient uuid, p_items text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
           'fabricId', p.fabric_id,
           'items', to_jsonb(p_items),
           'patient', jsonb_strip_nulls(jsonb_build_object(
             'name', p.full_name,
             'dob', to_char(p.dob, 'MM/DD/YYYY'),
             'sex', p.health -> 'patient' ->> 'sex',
             'phone',   case when 'intake' = any (p_items) then p.health -> 'patient' ->> 'phone' end,
             'email',   case when 'intake' = any (p_items) then p.health -> 'patient' ->> 'email' end,
             'address', case when 'intake' = any (p_items) then p.health -> 'patient' ->> 'address' end)))
         || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p.health) e
                      where e.key = any (p_items) and e.key = any (public.share_keys())), '{}'::jsonb)
  from public.patients p
  where p.id = p_patient
$$;

-- Clinic portal: add the signed-in user to the demo clinic. (A real product would use invites.)
create or replace function public.join_demo_clinic() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := '7b0e7a52-0000-4000-8000-000000000001';
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into public.clinic_members (clinic_id, user_id) values (v_id, auth.uid()) on conflict do nothing;
  return (select jsonb_build_object('id', c.id, 'name', c.name) from public.clinics c where c.id = v_id);
end $$;

-- Clinic: ask a patient (by Fabric ID) to share. The patient approves on their phone.
create or replace function public.request_consent(p_clinic uuid, p_fabric_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_patient public.patients%rowtype;
  v_clinic text;
  v_id uuid;
begin
  if not public.is_clinic_member(p_clinic) then
    raise exception 'You are not a member of this clinic' using errcode = '42501';
  end if;
  if (select count(*) from public.consent_requests
      where requested_by = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many requests. Wait a minute and try again.';
  end if;
  select * into v_patient from public.patients
   where fabric_id = upper(regexp_replace(coalesce(p_fabric_id, ''), '\s', '', 'g'));
  if not found then return jsonb_build_object('found', false); end if;

  select name into v_clinic from public.clinics where id = p_clinic;
  update public.consent_requests set status = 'cancelled'
   where clinic_id = p_clinic and patient_id = v_patient.id and status = 'pending';
  insert into public.consent_requests (clinic_id, clinic_name, patient_id, requested_by)
  values (p_clinic, v_clinic, v_patient.id, auth.uid())
  returning id into v_id;
  return jsonb_build_object('found', true, 'id', v_id, 'firstName', split_part(v_patient.full_name, ' ', 1));
end $$;

-- Clinic: give up on a request that is still waiting.
create or replace function public.cancel_consent(p_request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.consent_requests set status = 'cancelled'
   where id = p_request and status = 'pending' and public.is_clinic_member(clinic_id)
$$;

-- Patient: approve (with the sections they ticked) or decline. Requests go stale after 15 minutes.
create or replace function public.respond_consent(p_request uuid, p_approve boolean, p_items text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_items text[];
begin
  select coalesce(array_agg(distinct i), '{}') into v_items
    from unnest(coalesce(p_items, '{}')) i where i = any (public.share_keys());
  if p_approve and cardinality(v_items) = 0 then raise exception 'Choose at least one thing to share'; end if;

  update public.consent_requests
     set status       = case when p_approve then 'approved' else 'declined' end,
         items        = case when p_approve then v_items else '{}' end,
         responded_at = now(),
         expires_at   = case when p_approve then now() + interval '24 hours' end
   where id = p_request and patient_id = auth.uid() and status = 'pending'
     and created_at > now() - interval '15 minutes';
  if not found then raise exception 'This request is no longer open' using errcode = 'P0002'; end if;
end $$;

-- Patient: end a clinic's access early.
create or replace function public.end_consent(p_request uuid) returns void
language sql security definer set search_path = '' as $$
  update public.consent_requests set expires_at = now()
   where id = p_request and patient_id = auth.uid() and status = 'approved' and expires_at > now()
$$;

-- Clinic: read what the patient approved, while access lasts. Logged for the patient.
create or replace function public.get_consented_packet(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.consent_requests%rowtype;
begin
  select * into r from public.consent_requests where id = p_request;
  if not found or not public.is_clinic_member(r.clinic_id) then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.status <> 'approved' or r.expires_at <= now() then
    raise exception 'Access to these records has ended' using errcode = '42501';
  end if;
  insert into public.access_log (patient_id, actor, detail) values (r.patient_id, r.clinic_name, 'Viewed your records at check-in');
  return public._packet(r.patient_id, r.items)
         || jsonb_build_object('sharedAt', r.responded_at, 'expires', r.expires_at);
end $$;

-- Anyone with a link: read what the patient put in it, until it expires. Logged for the patient.
create or replace function public.get_shared_summary(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.share_links%rowtype;
begin
  select * into l from public.share_links where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if l.revoked or l.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  insert into public.access_log (patient_id, actor, detail) values (l.patient_id, 'Shared link', 'Opened in a browser');
  return jsonb_build_object('ok', true)
         || public._packet(l.patient_id, l.items)
         || jsonb_build_object('sharedAt', l.created_at, 'expires', l.expires_at);
end $$;

-- ---------------------------------------------------------------- function permissions
-- Supabase grants new functions to anon and authenticated by default. Lock them down.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.share_keys()                               to anon, authenticated;
grant execute on function public.new_fabric_id()                            to authenticated;
grant execute on function public.is_clinic_member(uuid)                     to authenticated;
grant execute on function public.join_demo_clinic()                         to authenticated;
grant execute on function public.request_consent(uuid, text)                to authenticated;
grant execute on function public.cancel_consent(uuid)                       to authenticated;
grant execute on function public.respond_consent(uuid, boolean, text[])     to authenticated;
grant execute on function public.end_consent(uuid)                          to authenticated;
grant execute on function public.get_consented_packet(uuid)                 to authenticated;
grant execute on function public.get_shared_summary(text)                   to anon, authenticated;
-- public._packet stays private: only the functions above call it.
