-- عقلي الثاني: مخطط المؤسسة على Supabase
-- المرحلة ١: الحسابات (المدير، والموظفون، والدعوات)
--
-- انسخ هذا الملف كاملاً في Supabase ← SQL Editor ← New query، ثم اضغط Run.
-- يمكن تشغيله أكثر من مرة دون ضرر.
--
-- المبادئ:
-- • أول من يُنشئ المؤسسة هو المدير، ولا يمكن إنشاء مؤسسة ثانية في المشروع نفسه.
-- • لا يضيف موظفاً ولا يحذفه ولا يرى الدعوات إلا المدير (مفروض في قاعدة البيانات نفسها، لا في الواجهة فقط).
-- • الموظف ينضم بدعوة من المدير فقط؛ من يسجّل دون دعوة لا يرى شيئاً.
-- • ملاحظات الموظف الشخصية لا تصل إلى هنا أبداً؛ تبقى على جواله.

create extension if not exists pgcrypto;

-- ---------- الجداول ----------
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  role text not null check (role in ('manager', 'employee')),
  display_name text not null check (length(display_name) between 1 and 60),
  username text not null,
  created_at timestamptz not null default now(),
  unique (org_id, username)
);

create table if not exists public.invites (
  code text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  username text not null check (username ~ '^[a-z0-9._-]{3,30}$'),
  created_by uuid references auth.users(id) on delete set null,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, username)
);

-- ---------- دوال مساعدة (تتجاوز RLS بأمان لأنها تقرأ صف المستخدم نفسه فقط) ----------
create or replace function public.my_org() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from public.members where user_id = auth.uid()
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'manager')
$$;

-- ---------- صلاحيات الصفوف (RLS) ----------
alter table public.orgs enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;

drop policy if exists orgs_read on public.orgs;
create policy orgs_read on public.orgs for select using (id = public.my_org());

drop policy if exists orgs_rename on public.orgs;
create policy orgs_rename on public.orgs for update
  using (id = public.my_org() and public.is_manager()) with check (id = public.my_org());

-- أعضاء المؤسسة يرون أسماء بعضهم (للمحادثة المشتركة لاحقاً)
drop policy if exists members_read on public.members;
create policy members_read on public.members for select using (org_id = public.my_org());

-- المدير وحده يحذف موظفاً (ولا يحذف نفسه). تعديل الأسماء والأدوار غير مسموح مباشرة.
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete
  using (org_id = public.my_org() and public.is_manager() and user_id <> auth.uid());

-- الدعوات: للمدير فقط
drop policy if exists invites_manager on public.invites;
create policy invites_manager on public.invites for all
  using (org_id = public.my_org() and public.is_manager())
  with check (org_id = public.my_org() and public.is_manager());

-- لا إدراج مباشر في orgs أو members: يتم فقط عبر الدوال أدناه
revoke insert on public.orgs, public.members from anon, authenticated;

-- ---------- الدوال التي يستدعيها التطبيق ----------

-- إنشاء المؤسسة: مرة واحدة فقط في المشروع، ويصبح المنشئ هو المدير
create or replace function public.create_org(org_name text, my_name text, my_username text)
returns uuid language plpgsql security definer set search_path = public as $$
declare oid uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.orgs) then raise exception 'org_exists'; end if;
  insert into public.orgs (name, owner) values (org_name, auth.uid()) returning id into oid;
  insert into public.members (user_id, org_id, role, display_name, username)
    values (auth.uid(), oid, 'manager', my_name, lower(my_username));
  return oid;
end $$;

-- هل أُنشئت المؤسسة بعد؟ (لشاشة الدخول)
create or replace function public.org_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orgs)
$$;

-- معلومات الدعوة قبل الانضمام (بلا تسجيل دخول): الاسم واسم المستخدم فقط
create or replace function public.invite_info(c text)
returns table (org_name text, display_name text, username text)
language sql stable security definer set search_path = public as $$
  select o.name, i.display_name, i.username
  from public.invites i join public.orgs o on o.id = i.org_id
  where i.code = c and i.used_by is null
$$;

-- الانضمام بدعوة: يربط الحساب الجديد بالمؤسسة كموظف
create or replace function public.redeem_invite(c text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into inv from public.invites where code = c and used_by is null for update;
  if not found then raise exception 'bad_code'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  insert into public.members (user_id, org_id, role, display_name, username)
    values (auth.uid(), inv.org_id, 'employee', inv.display_name, inv.username);
  update public.invites set used_by = auth.uid() where code = c;
end $$;

revoke execute on function public.create_org(text, text, text), public.redeem_invite(text) from public, anon;
grant execute on function public.create_org(text, text, text), public.redeem_invite(text) to authenticated;
grant execute on function public.org_exists(), public.invite_info(text) to anon, authenticated;
grant execute on function public.my_org(), public.is_manager() to authenticated;
