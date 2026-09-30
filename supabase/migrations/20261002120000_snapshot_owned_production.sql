-- Forward manufacturing contract. Replay preserves existing order-owned data.
begin;

alter table public.order_design_snapshots
  add column if not exists snapshot_schema_version integer not null default 0,
  add column if not exists production_mode text not null default 'legacy';
alter table public.order_design_snapshots drop constraint if exists order_design_snapshots_render_status_check;
alter table public.order_design_snapshots add constraint order_design_snapshots_render_status_check
  check (render_status in ('pending','queued','processing','completed','failed','archived','manual_required','manual_complete','remediation_required'));
alter table public.order_design_snapshots drop constraint if exists snapshot_production_mode_check;
alter table public.order_design_snapshots add constraint snapshot_production_mode_check check (production_mode in ('automatic','manual','legacy'));
-- Do not reinterpret old resolved documents as complete renderer inputs.
update public.order_design_snapshots set render_status = 'remediation_required'
 where snapshot_schema_version = 0 and render_status not in ('completed','archived','remediation_required');

alter table public.customizer_render_jobs
  add column if not exists snapshot_id uuid references public.order_design_snapshots(id) on delete restrict,
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict;
alter table public.customizer_render_outputs
  add column if not exists snapshot_id uuid references public.order_design_snapshots(id) on delete restrict,
  add column if not exists order_item_id uuid references public.order_items(id) on delete restrict;
-- Production survives source deletion, including the account cascade.
alter table public.customizer_render_jobs drop constraint if exists customizer_render_jobs_customization_id_fkey;
alter table public.customizer_render_jobs add constraint customizer_render_jobs_customization_id_fkey
  foreign key (customization_id) references public.product_customizations(id) on delete set null;
alter table public.customizer_render_outputs drop constraint if exists customizer_render_outputs_customization_id_fkey;
alter table public.customizer_render_outputs add constraint customizer_render_outputs_customization_id_fkey
  foreign key (customization_id) references public.product_customizations(id) on delete set null;
create unique index if not exists snapshot_render_job_identity on public.customizer_render_jobs(snapshot_id,job_type) where snapshot_id is not null;
create unique index if not exists snapshot_output_identity on public.customizer_render_outputs(snapshot_id,job_id,page_id,format) where snapshot_id is not null;
revoke insert,update,delete on public.order_design_snapshots,public.customizer_render_jobs,public.customizer_render_outputs from anon,authenticated;

create table if not exists public.order_production_assets (
  snapshot_id uuid not null references public.order_design_snapshots(id) on delete restrict,
  order_id text not null references public.orders(id) on delete restrict,
  asset_key text not null check (asset_key ~ '^[a-f0-9]{64}$'),
  bucket text not null check (bucket = 'order-production'),
  path text not null,
  checksum text not null check (checksum = asset_key),
  size_bytes bigint not null check (size_bytes between 1 and 31457280),
  mime_type text not null,
  kind text not null check (kind in ('image','font','license','document')),
  created_at timestamptz not null default now(),
  primary key (snapshot_id,asset_key),
  check (path = 'orders/' || order_id || '/assets/' || checksum)
);
-- Older applications of this contract allowed only images/fonts/licenses.
-- Replays retain those rows while enabling the current manual PDF asset kind.
alter table public.order_production_assets drop constraint if exists order_production_assets_kind_check;
alter table public.order_production_assets add constraint order_production_assets_kind_check
  check (kind in ('image','font','license','document'));
create index if not exists order_production_assets_order on public.order_production_assets(order_id);
alter table public.order_production_assets enable row level security;
revoke all on public.order_production_assets from anon,authenticated;
grant select on public.order_production_assets to authenticated;
grant select,insert on public.order_production_assets to service_role;
drop policy if exists order_production_assets_admin_read on public.order_production_assets;
create policy order_production_assets_admin_read on public.order_production_assets for select using (public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values ('order-production','order-production',false,31457280,array['image/png','image/jpeg','image/webp','image/svg+xml','font/ttf','text/plain','application/pdf'])
 on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- No authenticated storage policy is granted for the production bucket.
-- Access goes through an admin-authorized server endpoint; workers use service role.

create or replace function public.initialize_snapshot_production() returns trigger
language plpgsql set search_path = public as $$
declare p jsonb;
begin
  p := new.snapshot->'production';
  if new.snapshot->>'snapshotSchemaVersion' = '1' and p->>'rendererVersion' = 'husnalogy-snapshot-1'
     and p->>'mode' in ('automatic','manual') and jsonb_typeof(p->'assets') = 'array'
     and jsonb_typeof(p->'fonts') = 'array' and jsonb_typeof(p->'fontCatalog') = 'array'
     and jsonb_typeof(p->'template') = 'object' then
    new.snapshot_schema_version := 1;
    new.production_mode := p->>'mode';
    new.render_status := case when new.production_mode = 'manual' then 'manual_required' else 'pending' end;
  else
    new.snapshot_schema_version := 0;
    new.production_mode := 'legacy';
    new.render_status := 'remediation_required';
  end if;
  return new;
end $$;
drop trigger if exists initialize_snapshot_production on public.order_design_snapshots;
create trigger initialize_snapshot_production before insert on public.order_design_snapshots
 for each row execute function public.initialize_snapshot_production();

create or replace function public.register_snapshot_assets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.snapshot_schema_version = 1 then
    insert into public.order_production_assets(snapshot_id,order_id,asset_key,bucket,path,checksum,size_bytes,mime_type,kind)
    select new.id,new.order_id,a->>'key',a->>'bucket',a->>'path',a->>'checksum',(a->>'size')::bigint,a->>'mimeType',a->>'kind'
      from jsonb_array_elements(new.snapshot#>'{production,assets}') a;
  end if;
  return new;
end $$;
drop trigger if exists register_snapshot_assets on public.order_design_snapshots;
create trigger register_snapshot_assets after insert on public.order_design_snapshots for each row execute function public.register_snapshot_assets();

create or replace function public.snapshot_manual_personalization() returns trigger language plpgsql security definer set search_path=public as $$
declare contract jsonb; sid uuid;
begin
 if new.customization_id is null and new.metadata ? 'productionSnapshot' then
  contract:=new.metadata->'productionSnapshot';
  insert into public.order_design_snapshots(order_id,order_item_id,product_id,product_title,product_sku,quantity,selected_options,pricing,snapshot,integrity_hash)
   values(new.order_id,new.id,new.product_id,new.product_title,new.product_sku,new.quantity,new.selected_options,new.pricing,contract-'integrityHash',contract->>'integrityHash') returning id into sid;
  insert into public.production_tasks(order_id,order_item_id,snapshot_id,source) values(new.order_id,new.id,sid,'checkout');
 end if;
 return new;
end $$;
drop trigger if exists snapshot_manual_personalization on public.order_items;
create trigger snapshot_manual_personalization after insert on public.order_items for each row execute function public.snapshot_manual_personalization();

-- Neither cleanup nor a direct storage delete may remove committed production bytes.
create or replace function public.guard_pinned_production_storage() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (old.bucket_id='order-production' and exists(select 1 from public.order_production_assets where bucket=old.bucket_id and path=old.name))
   or (old.bucket_id='customizer-renders' and exists(select 1 from public.customizer_render_outputs where snapshot_id is not null and bucket=old.bucket_id and path=old.name and status='ready')) then
  raise exception 'COMMITTED_PRODUCTION_ASSET_IMMUTABLE';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_pinned_production_storage on storage.objects;
create trigger guard_pinned_production_storage before update or delete on storage.objects for each row execute function public.guard_pinned_production_storage();

-- New checkouts cannot finalize an incomplete production contract, even through RPC.
create or replace function public.require_finalized_production_contract() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.checkout_state = 'finalized' and old.checkout_state is distinct from 'finalized' and exists (
    select 1 from public.order_items i left join public.order_design_snapshots s on s.order_item_id=i.id
     where i.order_id=new.id and (i.customization_id is not null or i.customization_values<>'{}'::jsonb or i.uploaded_files<>'{}'::jsonb)
       and (s.id is null or s.snapshot_schema_version <> 1 or s.production_mode='legacy')
  ) then raise exception 'CHECKOUT_PRODUCTION_CONTRACT_REQUIRED'; end if;
  if new.checkout_state='finalized' and old.checkout_state is distinct from 'finalized' and exists (
    select 1 from public.order_production_assets a where a.order_id=new.id and not exists(select 1 from storage.objects o where o.bucket_id=a.bucket and o.name=a.path and o.created_at>now()-interval '24 hours')
  ) then raise exception 'CHECKOUT_PRODUCTION_ASSET_MISSING'; end if;
  return new;
end $$;
drop trigger if exists require_finalized_production_contract on public.orders;
create trigger require_finalized_production_contract before update on public.orders for each row execute function public.require_finalized_production_contract();

-- Only abandoned private copies/attempts are candidates. New finalization
-- requires assets younger than 24h, so a >48h candidate cannot race checkout.
-- Delete through the Storage API, never directly from storage.objects.
create or replace function public.production_storage_cleanup_candidates(p_limit integer default 25)
returns table(bucket text,path text) language sql stable security definer set search_path=public,storage as $$
 select o.bucket_id,o.name from storage.objects o
 where o.bucket_id in ('order-production','customizer-renders') and o.name like 'orders/%'
 and o.created_at<now()-interval '48 hours'
 and not exists(select 1 from public.order_production_assets a where a.bucket=o.bucket_id and a.path=o.name)
 and not exists(select 1 from public.customizer_render_outputs r where r.bucket=o.bucket_id and r.path=o.name and r.status='ready')
 order by o.created_at limit least(25,greatest(1,p_limit))
$$;

-- Stable snapshot lineage is mandatory for every new order render job.
create or replace function public.guard_snapshot_job() returns trigger
language plpgsql set search_path = public as $$
declare s public.order_design_snapshots;
begin
  if new.order_id is not null then
    select * into s from public.order_design_snapshots where id=new.snapshot_id;
    if s.id is null or s.order_id <> new.order_id or s.order_item_id is distinct from new.order_item_id
       or s.snapshot_schema_version <> 1 or s.production_mode <> 'automatic'
       or not (s.snapshot#>'{production,requiredJobTypes}' ? new.job_type) then
      raise exception 'ORDER_RENDER_REQUIRES_IMMUTABLE_SNAPSHOT';
    end if;
    new.customization_id := null;
    new.template_version_id := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_snapshot_job on public.customizer_render_jobs;
create trigger guard_snapshot_job before insert on public.customizer_render_jobs for each row execute function public.guard_snapshot_job();

create or replace function public.enqueue_snapshot_render_job(p_snapshot_id uuid,p_job_type text,p_input_hash text)
returns public.customizer_render_jobs language plpgsql security definer set search_path=public as $$
declare s public.order_design_snapshots; j public.customizer_render_jobs;
begin
  select * into s from public.order_design_snapshots where id=p_snapshot_id for update;
  if s.id is null or s.snapshot_schema_version<>1 or s.production_mode<>'automatic'
     or not (s.snapshot#>'{production,requiredJobTypes}' ? p_job_type)
     or not exists(select 1 from public.orders where id=s.order_id and checkout_state='finalized') then
    raise exception 'SNAPSHOT_RENDER_NOT_ALLOWED';
  end if;
  insert into public.customizer_render_jobs(snapshot_id,order_id,order_item_id,job_type,status,priority,input_hash,input_snapshot)
   values(s.id,s.order_id,s.order_item_id,p_job_type,'queued',10,p_input_hash,jsonb_build_object('snapshotId',s.id,'snapshotSchemaVersion',1))
   on conflict(snapshot_id,job_type) where snapshot_id is not null do nothing;
  select * into j from public.customizer_render_jobs where snapshot_id=s.id and job_type=p_job_type;
  if j.input_hash<>p_input_hash then raise exception 'SNAPSHOT_JOB_CHECKSUM_MISMATCH'; end if;
  return j;
end $$;

-- Output attachment + job acknowledgement + aggregate snapshot state commit atomically.
create or replace function public.mark_snapshot_render_processing(p_job_id uuid,p_lock_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare sid uuid;
begin
 select snapshot_id into sid from public.customizer_render_jobs where id=p_job_id;
 perform 1 from public.order_design_snapshots where id=sid for update;
 perform 1 from public.customizer_render_jobs where id=p_job_id and status='processing' and lock_token=p_lock_token and lock_expires_at>now() for update;
 if not found then return false; end if;
 update public.order_design_snapshots set render_status='processing' where id=sid and snapshot_schema_version=1 and production_mode='automatic';
 return found;
end $$;

create or replace function public.fail_snapshot_render_job(p_job_id uuid,p_lock_token uuid,p_code text,p_message text,p_cancelled boolean default false)
returns public.customizer_render_jobs language plpgsql security definer set search_path=public as $$
declare j public.customizer_render_jobs; sid uuid;
begin
 select snapshot_id into sid from public.customizer_render_jobs where id=p_job_id;
 perform 1 from public.order_design_snapshots where id=sid for update;
 select * into j from public.customizer_render_jobs where id=p_job_id for update;
 if sid is null then raise exception 'SNAPSHOT_REQUIRED'; end if;
 if j.status<>'processing' or j.lock_token is distinct from p_lock_token then return j; end if;
 update public.customizer_render_jobs set attempt_count=attempt_count+1,
  status=case when p_cancelled then 'cancelled' when attempt_count+1>=3 then 'failed' else 'retrying' end,
  error_code=left(p_code,100),error_message=left(p_message,1000),
  next_attempt_at=case when not p_cancelled and attempt_count+1<3 then now()+make_interval(secs=>15*power(2,attempt_count)::integer) else null end,
  completed_at=case when p_cancelled or attempt_count+1>=3 then now() else null end,
  locked_by=null,lock_token=null,lock_expires_at=null,heartbeat_at=now() where id=p_job_id returning * into j;
 update public.order_design_snapshots set render_status=case
  when exists(select 1 from public.customizer_render_jobs where snapshot_id=sid and status in ('failed','cancelled')) then 'failed'
  when exists(select 1 from public.customizer_render_jobs where snapshot_id=sid and status='processing') then 'processing' else 'queued' end where id=sid;
 return j;
end $$;

create or replace function public.commit_snapshot_render_result(p_job_id uuid,p_lock_token uuid,p_outputs jsonb)
returns public.customizer_render_jobs language plpgsql security definer set search_path=public as $$
declare j public.customizer_render_jobs; s public.order_design_snapshots; o jsonb; files jsonb := '{}'; n integer;
begin
  -- Snapshot first is the global lock order used by enqueue/retry/reconciliation.
  select s0.* into s from public.order_design_snapshots s0 join public.customizer_render_jobs j0 on j0.snapshot_id=s0.id where j0.id=p_job_id for update of s0;
  select * into j from public.customizer_render_jobs where id=p_job_id for update;
  if j.status='completed' then return j; end if;
  if s.id is null or j.status<>'processing' or j.lock_token is distinct from p_lock_token or j.lock_expires_at<=now() then return null; end if;
  if jsonb_typeof(p_outputs)<>'array' or jsonb_array_length(p_outputs)=0 then raise exception 'PRODUCTION_OUTPUT_MISSING'; end if;
  n := case when j.job_type='print_pdf' then 1 else (select count(*) from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true)) end;
  if jsonb_array_length(p_outputs)<>n then raise exception 'PRODUCTION_PAGE_OUTPUT_MISSING'; end if;
  for o in select * from jsonb_array_elements(p_outputs) loop
    if o->>'job_id'<>j.id::text or o->>'order_id'<>s.order_id or o->>'bucket'<>'customizer-renders'
       or o->>'path' not like 'orders/' || s.order_id || '/snapshots/' || s.id || '/' || j.id || '/' || p_lock_token || '/%'
       or coalesce(o->>'checksum','') !~ '^[a-f0-9]{64}$' or (o->>'file_size_bytes')::bigint<1 or (o->>'watermarked')::boolean then raise exception 'PRODUCTION_OUTPUT_INVALID'; end if;
    if (j.job_type='print_pdf' and (o->>'page_id'<>'all' or o->>'format'<>'pdf'))
       or (j.job_type='print_png' and (o->>'format'<>'png' or not exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where p->>'id'=o->>'page_id' and coalesce((p->>'enabled')::boolean,true)))) then raise exception 'PRODUCTION_OUTPUT_PAGE_INVALID'; end if;
    insert into public.customizer_render_outputs(job_id,snapshot_id,order_id,order_item_id,customization_id,page_id,format,bucket,path,width_px,height_px,dpi,file_size_bytes,checksum,watermarked,render_engine_version,template_version,output_type,mime_type,input_hash,status,verified_at)
    values(j.id,s.id,s.order_id,s.order_item_id,null,o->>'page_id',o->>'format',o->>'bucket',o->>'path',(o->>'width_px')::integer,(o->>'height_px')::integer,(o->>'dpi')::integer,(o->>'file_size_bytes')::bigint,o->>'checksum',false,'husnalogy-snapshot-1',s.template_version,j.job_type,o->>'mime_type',j.input_hash,'ready',now())
    on conflict(snapshot_id,job_id,page_id,format) where snapshot_id is not null do update set
      path=excluded.path,checksum=excluded.checksum,file_size_bytes=excluded.file_size_bytes,status='ready',verified_at=now();
    files := files || jsonb_build_object(o->>'page_id',jsonb_build_object('bucket',o->>'bucket','path',o->>'path','format',o->>'format','checksum',o->>'checksum','widthPx',o->'width_px','heightPx',o->'height_px','dpi',o->'dpi','jobId',j.id));
  end loop;
  if (select count(*) from jsonb_object_keys(files))<>n then raise exception 'PRODUCTION_OUTPUT_DUPLICATE_PAGE'; end if;
  update public.customizer_render_jobs set status='completed',completed_at=now(),attempt_count=attempt_count+1,error_code=null,error_message=null,next_attempt_at=null,lock_token=null,locked_by=null,lock_expires_at=null where id=j.id returning * into j;
  update public.order_design_snapshots set print_files=print_files || jsonb_build_object(j.job_type,files),render_status=case
    when not exists(select 1 from jsonb_array_elements_text(snapshot#>'{production,requiredJobTypes}') t where not exists(select 1 from public.customizer_render_jobs r where r.snapshot_id=s.id and r.job_type=t and r.status='completed')) then 'completed'
    when exists(select 1 from public.customizer_render_jobs r where r.snapshot_id=s.id and r.status in ('failed','cancelled')) then 'failed' else 'queued' end where id=s.id;
  return j;
end $$;

-- Dispatch completion means required jobs exist, or a clearly marked manual handoff.
create or replace function public.finish_production_task(p_id uuid,p_lock_token uuid,p_error text default null,p_max_attempts integer default 8)
returns text language plpgsql security definer set search_path=public as $$
declare t public.production_tasks; s public.order_design_snapshots; v_status text;
begin
  select * into t from public.production_tasks where id=p_id and lock_token=p_lock_token and status='processing' for update;
  if t.id is null then return null; end if;
  select * into s from public.order_design_snapshots where id=t.snapshot_id;
  if p_error is null and (s.snapshot_schema_version<>1 or s.production_mode='legacy'
    or (s.production_mode='manual' and s.render_status not in ('manual_required','manual_complete'))
    or (s.production_mode='automatic' and exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k)))) then raise exception 'PRODUCTION_DISPATCH_INCOMPLETE'; end if;
  v_status := case when p_error is null then 'completed' when t.attempt_count>=p_max_attempts then 'failed' else 'pending' end;
  update public.production_tasks set status=v_status,completed_at=case when p_error is null then now() else null end,last_error=left(p_error,1000),next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(t.attempt_count,7))::integer)),lock_token=null,locked_until=null where id=t.id;
  return v_status;
end $$;

create table if not exists public.production_recovery_audit (
 id uuid primary key default gen_random_uuid(), actor_id uuid, target_type text not null,
 target_id uuid not null, order_id text not null, reason text not null,
 previous_state jsonb not null, created_at timestamptz not null default now()
);
alter table public.production_recovery_audit enable row level security;
revoke all on public.production_recovery_audit from anon,authenticated;
grant select on public.production_recovery_audit to authenticated;
grant select,insert on public.production_recovery_audit to service_role;
drop policy if exists production_recovery_audit_admin_read on public.production_recovery_audit;
create policy production_recovery_audit_admin_read on public.production_recovery_audit for select using(public.is_admin());

create or replace function public.invalidate_snapshot_output(p_output_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare r public.customizer_render_outputs; j public.customizer_render_jobs;
begin
 select * into r from public.customizer_render_outputs where id=p_output_id;
 if r.snapshot_id is null then raise exception 'SNAPSHOT_OUTPUT_REQUIRED'; end if;
 perform 1 from public.order_design_snapshots where id=r.snapshot_id for update;
 select * into j from public.customizer_render_jobs where id=r.job_id for update;
 if j.status<>'completed' then return; end if;
 insert into public.production_recovery_audit(target_type,target_id,order_id,reason,previous_state) values('output_verification',r.id,j.order_id,left(p_reason,500),jsonb_build_object('jobStatus',j.status,'checksum',r.checksum,'attemptCount',j.attempt_count));
 update public.customizer_render_outputs set status='invalid' where id=r.id;
 update public.customizer_render_jobs set status=case when attempt_count>=3 then 'failed' else 'retrying' end,next_attempt_at=now(),completed_at=null,error_code='OUTPUT_VERIFICATION_FAILED',error_message=left(p_reason,1000) where id=j.id;
 update public.order_design_snapshots set render_status=case when j.attempt_count>=3 then 'failed' else 'queued' end where id=r.snapshot_id;
end $$;

create table if not exists public.manual_production_completions (
 snapshot_id uuid primary key references public.order_design_snapshots(id) on delete restrict,
 actor_id uuid not null, evidence text not null check(length(evidence) between 10 and 1000),
 completed_at timestamptz not null default now()
);
alter table public.manual_production_completions enable row level security;
revoke all on public.manual_production_completions from anon,authenticated;
grant select on public.manual_production_completions to authenticated;
grant select,insert on public.manual_production_completions to service_role;
drop policy if exists manual_production_completions_admin_read on public.manual_production_completions;
create policy manual_production_completions_admin_read on public.manual_production_completions for select using(public.is_admin());
create or replace function public.complete_manual_production(p_snapshot_id uuid,p_actor_id uuid,p_evidence text)
returns void language plpgsql security definer set search_path=public as $$
declare s public.order_design_snapshots;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 select * into s from public.order_design_snapshots where id=p_snapshot_id for update;
 if s.id is null or s.production_mode<>'manual' or s.snapshot_schema_version<>1 or s.render_status not in ('manual_required','manual_complete') then raise exception 'MANUAL_COMPLETION_NOT_ALLOWED'; end if;
 insert into public.manual_production_completions(snapshot_id,actor_id,evidence) values(s.id,p_actor_id,p_evidence) on conflict(snapshot_id) do nothing;
 if not found then return; end if;
 insert into public.production_recovery_audit(actor_id,target_type,target_id,order_id,reason,previous_state) values(p_actor_id,'manual_complete',s.id,s.order_id,p_evidence,jsonb_build_object('status',s.render_status));
 update public.order_design_snapshots set render_status='manual_complete' where id=s.id;
end $$;

create or replace function public.retry_production_work(p_kind text,p_id uuid,p_actor_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.order_design_snapshots; j public.customizer_render_jobs; t public.production_tasks; n public.notification_tasks; previous jsonb; oid text;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>500 then raise exception 'RETRY_REASON_REQUIRED'; end if;
 if p_kind='notification' then
  select * into n from public.notification_tasks where id=p_id for update;
  if n.id is null or n.status<>'failed' or n.provider_message_id is not null then raise exception 'NOTIFICATION_RETRY_NOT_ALLOWED'; end if;
  if n.last_error like 'DELIVERY_UNCERTAIN%' then raise exception 'VERIFY_PROVIDER_DELIVERY_BEFORE_RETRY'; end if;
  previous:=jsonb_build_object('status',n.status,'error',n.last_error,'attemptCount',n.attempt_count); oid:=n.order_id;
  update public.notification_tasks set status='pending',attempt_count=0,next_attempt_at=now(),last_error=null,lock_token=null,locked_until=null where id=p_id;
 elsif p_kind in ('render','production','snapshot') then
  if p_kind='render' then select s0.* into s from public.order_design_snapshots s0 join public.customizer_render_jobs j0 on j0.snapshot_id=s0.id where j0.id=p_id for update of s0;
  elsif p_kind='production' then select s0.* into s from public.order_design_snapshots s0 join public.production_tasks t0 on t0.snapshot_id=s0.id where t0.id=p_id for update of s0;
  else select * into s from public.order_design_snapshots where id=p_id for update; end if;
  if s.id is null or s.snapshot_schema_version<>1 or s.production_mode<>'automatic' then raise exception 'SNAPSHOT_REQUIRES_REMEDIATION_OR_MANUAL_PRODUCTION'; end if;
  if exists(select 1 from public.customizer_render_jobs where snapshot_id=s.id and status='processing' and lock_expires_at>now())
    or exists(select 1 from public.production_tasks where snapshot_id=s.id and status='processing' and locked_until>now()) then raise exception 'PRODUCTION_WORK_BUSY'; end if;
  if p_kind='render' then
    select * into j from public.customizer_render_jobs where id=p_id for update;
    if j.status not in ('failed','cancelled') then raise exception 'RENDER_RETRY_NOT_ALLOWED'; end if;
    previous:=jsonb_build_object('status',j.status,'error',j.error_message,'attemptCount',j.attempt_count);
    update public.customizer_render_jobs set status='queued',attempt_count=0,next_attempt_at=now(),error_code=null,error_message=null,cancel_requested_at=null,completed_at=null,lock_token=null,lock_expires_at=null,locked_by=null where id=p_id;
  else
    select * into t from public.production_tasks where snapshot_id=s.id for update;
    previous:=jsonb_build_object('status',t.status,'error',t.last_error,'attemptCount',t.attempt_count,'snapshotStatus',s.render_status);
    insert into public.production_tasks(order_id,order_item_id,snapshot_id,source) values(s.order_id,s.order_item_id,s.id,'admin')
      on conflict(snapshot_id,task_type) do update set status='pending',source='admin',attempt_count=0,last_error=null,next_attempt_at=now(),completed_at=null,lock_token=null,locked_until=null;
    -- Reset failed logical jobs, never duplicate successfully completed output.
    update public.customizer_render_jobs set status='queued',attempt_count=0,next_attempt_at=now(),error_code=null,error_message=null,cancel_requested_at=null,completed_at=null,lock_token=null,lock_expires_at=null,locked_by=null where snapshot_id=s.id and status in ('failed','cancelled');
  end if;
  oid:=s.order_id;
  update public.order_design_snapshots set render_status='queued' where id=s.id and render_status<>'completed';
 else raise exception 'RETRY_KIND_INVALID'; end if;
 insert into public.production_recovery_audit(actor_id,target_type,target_id,order_id,reason,previous_state) values(p_actor_id,p_kind,p_id,oid,p_reason,previous);
 return jsonb_build_object('ok',true,'orderId',oid,'targetId',p_id);
end $$;

create or replace function public.reconcile_production(p_older_than_seconds integer default 600)
returns integer language plpgsql security definer set search_path=public as $$
declare repaired integer:=0; n integer;
begin
 -- Serialize chain repair with output commit and admin recovery, snapshot first.
 perform 1 from public.order_design_snapshots s where snapshot_schema_version=1 and (
  render_status not in ('completed','manual_complete','archived') or
  exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k)) or
  exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png')))))) order by s.id for update;
 insert into public.production_tasks(order_id,order_item_id,snapshot_id,customization_id,source)
 select s.order_id,s.order_item_id,s.id,s.customization_id,'recovery' from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized'
 where s.snapshot_schema_version=1 and s.render_status not in ('completed','manual_complete','archived') and s.created_at<now()-make_interval(secs=>greatest(0,p_older_than_seconds))
 on conflict(snapshot_id,task_type) do nothing;
 get diagnostics n=row_count; repaired:=repaired+n;
 -- A completed dispatch whose automatic chain lost a job is safely re-dispatched.
 update public.production_tasks t set status='pending',next_attempt_at=now(),completed_at=null,last_error='Reconciliation: required render job missing'
 from public.order_design_snapshots s where t.snapshot_id=s.id and t.status='completed' and s.production_mode='automatic' and s.snapshot_schema_version=1
 and exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k));
 get diagnostics n=row_count; repaired:=repaired+n;
 -- Completed job without its expected verified page records is not complete.
 update public.customizer_render_jobs j set status='retrying',next_attempt_at=now(),completed_at=null,error_code='OUTPUT_VERIFICATION_FAILED',error_message='Reconciliation: required output records missing'
 from public.order_design_snapshots s where j.snapshot_id=s.id and j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png'))));
 get diagnostics n=row_count; repaired:=repaired+n;
 update public.order_design_snapshots s set render_status='queued' where s.production_mode='automatic' and s.render_status='completed' and (
  exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status<>'completed') or
  exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k)));
 return repaired;
end $$;
create or replace function public.enqueue_missing_production_tasks(p_older_than_seconds integer default 600)
returns integer language sql security definer set search_path=public as $$ select public.reconcile_production(p_older_than_seconds) $$;

-- Crashes/timeouts consume an attempt too; abandoned jobs cannot retry forever.
create or replace function public.recover_abandoned_customizer_render_jobs()
returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
 if auth.role()<>'service_role' then raise exception 'service role required'; end if;
 perform 1 from public.order_design_snapshots s where exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status='processing' and j.lock_expires_at<now()) order by s.id for update;
 update public.customizer_render_jobs set attempt_count=attempt_count+1,
  status=case when attempt_count+1>=3 then 'failed' else 'retrying' end,
  error_code='WORKER_LEASE_EXPIRED',error_message='Execution deadline or worker crash: lease recovered.',
  locked_by=null,lock_token=null,lock_expires_at=null,next_attempt_at=case when attempt_count+1<3 then now() else null end,updated_at=now()
 where status='processing' and lock_expires_at<now();
 get diagnostics n=row_count;
 update public.order_design_snapshots s set render_status=case
  when exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status in ('failed','cancelled')) then 'failed' else 'queued' end
 where s.production_mode='automatic' and s.render_status='processing' and not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.status='processing');
 return n;
end $$;

-- No unsafe catalogue deletion while an accepted legacy design still needs it.
create or replace function public.guard_product_fulfillment_delete() returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from public.order_design_snapshots s join public.orders o on o.id=s.order_id where s.product_id=old.id and o.checkout_state='finalized' and o.status not in ('delivered','cancelled') and s.snapshot_schema_version<>1) then raise exception 'PRODUCT_HAS_DEPENDENT_PRODUCTION'; end if;
 return old;
end $$;
drop trigger if exists guard_product_fulfillment_delete on public.products;
create trigger guard_product_fulfillment_delete before delete on public.products for each row execute function public.guard_product_fulfillment_delete();

create or replace function public.prevent_customizer_version_mutation() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.order_design_snapshots s join public.orders o on o.id=s.order_id where (s.template_version_id=old.id or s.template_id=old.template_id) and s.snapshot_schema_version<>1 and o.checkout_state='finalized') then raise exception 'TEMPLATE_HAS_DEPENDENT_LEGACY_PRODUCTION'; end if;
  return old;
 end if;
 -- Parent erasure may clear diagnostic references, never change a published design.
 if (to_jsonb(new)-array['product_id','published_by'])=(to_jsonb(old)-array['product_id','published_by'])
   and (new.product_id is null or new.product_id is not distinct from old.product_id)
   and (new.published_by is null or new.published_by is not distinct from old.published_by) then return new; end if;
 raise exception 'Published customizer versions are immutable';
end $$;

-- The checkout migration added a SECOND version guard. Both must permit
-- diagnostic FK nulling; relaxing only the older guard still blocks deletion.
create or replace function public.protect_template_version() returns trigger language plpgsql set search_path=public as $$
begin
 if current_user in ('postgres','supabase_admin') and coalesce(auth.role(),'')='' then return new; end if;
 if (to_jsonb(new)-array['notes','product_id','published_by']) is not distinct from (to_jsonb(old)-array['notes','product_id','published_by'])
   and (new.product_id is null or new.product_id is not distinct from old.product_id)
   and (new.published_by is null or new.published_by is not distinct from old.published_by) then return new; end if;
 raise exception 'Published customizer template versions are immutable; publish a new version instead.' using errcode='42501';
end $$;

create or replace function public.guard_fulfillment_history_delete() returns trigger language plpgsql set search_path=public as $$
declare oid text;
begin
 oid:=case when tg_table_name='orders' then old.id::text else old.order_id end;
 if exists(select 1 from public.orders where id=oid and checkout_state='finalized') then raise exception 'FINALIZED_FULFILLMENT_HISTORY_MUST_BE_RETAINED'; end if;
 return old;
end $$;
drop trigger if exists guard_order_history_delete on public.orders;
create trigger guard_order_history_delete before delete on public.orders for each row execute function public.guard_fulfillment_history_delete();
drop trigger if exists guard_order_item_history_delete on public.order_items;
create trigger guard_order_item_history_delete before delete on public.order_items for each row execute function public.guard_fulfillment_history_delete();
drop trigger if exists guard_snapshot_history_delete on public.order_design_snapshots;
create trigger guard_snapshot_history_delete before delete on public.order_design_snapshots for each row execute function public.guard_fulfillment_history_delete();

alter table public.notification_tasks add column if not exists first_delivery_attempt_at timestamptz,
 add column if not exists delivery_payload jsonb,
 add column if not exists delivery_generation integer not null default 0 check(delivery_generation>=0);
create or replace function public.prepare_notification_delivery(p_id uuid,p_lock_token uuid,p_message jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n public.notification_tasks;
begin
 update public.notification_tasks set first_delivery_attempt_at=coalesce(first_delivery_attempt_at,now()),delivery_payload=coalesce(delivery_payload,p_message)
  where id=p_id and lock_token=p_lock_token and status='processing' and locked_until>now() returning * into n;
 if n.id is null then return null; end if;
 return jsonb_build_object('message',n.delivery_payload,'firstAttemptAt',n.first_delivery_attempt_at);
end $$;
create or replace function public.record_notification_delivery(p_id uuid,p_lock_token uuid,p_provider_id text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if length(coalesce(p_provider_id,''))<1 then raise exception 'PROVIDER_REFERENCE_REQUIRED'; end if;
 update public.notification_tasks set provider_message_id=p_provider_id,status='sent',sent_at=now(),last_error=null,lock_token=null,locked_until=null
 where id=p_id and lock_token=p_lock_token and status='processing';
 return found;
end $$;
create or replace function public.resolve_notification_delivery(p_id uuid,p_actor_id uuid,p_delivered boolean,p_provider_id text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare n public.notification_tasks;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 select * into n from public.notification_tasks where id=p_id for update;
 if n.id is null or n.status not in ('failed','pending') or n.provider_message_id is not null or length(trim(coalesce(p_reason,'')))<10 then raise exception 'DELIVERY_REVIEW_REQUIRED'; end if;
 if p_delivered and length(coalesce(p_provider_id,''))<1 then raise exception 'PROVIDER_REFERENCE_REQUIRED'; end if;
 insert into public.production_recovery_audit(actor_id,target_type,target_id,order_id,reason,previous_state)
 values(p_actor_id,'notification_delivery_review',n.id,n.order_id,left(p_reason,500),jsonb_build_object('status',n.status,'error',n.last_error,'attemptCount',n.attempt_count,'firstAttemptAt',n.first_delivery_attempt_at,'delivered',p_delivered));
 update public.notification_tasks set status=case when p_delivered then 'sent' else 'pending' end,provider_message_id=case when p_delivered then p_provider_id else null end,sent_at=case when p_delivered then now() else null end,
  first_delivery_attempt_at=case when p_delivered then first_delivery_attempt_at else null end,
  delivery_payload=case when p_delivered then delivery_payload else null end,
  delivery_generation=delivery_generation+case when p_delivered then 0 else 1 end,
  attempt_count=0,next_attempt_at=now(),last_error=null,lock_token=null,locked_until=null where id=p_id;
end $$;
alter table public.worker_runs add column if not exists last_success_at timestamptz, add column if not exists last_failure_at timestamptz;
create or replace function public.record_worker_outcome() returns trigger language plpgsql set search_path=public as $$
begin
 if new.last_status='ok' then new.last_success_at:=new.last_finished_at;
 elsif new.last_status='error' then new.last_failure_at:=new.last_finished_at; end if;
 return new;
end $$;
drop trigger if exists record_worker_outcome on public.worker_runs;
create trigger record_worker_outcome before insert or update on public.worker_runs for each row execute function public.record_worker_outcome();

-- Existing queue counters are retained; chain failures are explicit and countable.
do $$ begin
 if to_regprocedure('public.production_queue_health()') is null then
  alter function public.production_health() rename to production_queue_health;
 end if;
end $$;
create or replace function public.production_health() returns jsonb language sql stable security definer set search_path=public as $$
 select public.production_queue_health() || jsonb_build_object('chain',jsonb_build_object(
  'missingSnapshots',(select count(*) from public.order_items i join public.orders o on o.id=i.order_id and o.checkout_state='finalized' where (i.customization_id is not null or i.metadata ? 'customizationId' or i.customization_values<>'{}'::jsonb or i.uploaded_files<>'{}'::jsonb or i.metadata ? 'productionSnapshot') and not exists(select 1 from public.order_design_snapshots s where s.order_item_id=i.id)),
  'legacySnapshots',(select count(*) from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized' where s.snapshot_schema_version<>1),
  'missingTasks',(select count(*) from public.order_design_snapshots s join public.orders o on o.id=s.order_id and o.checkout_state='finalized' where not exists(select 1 from public.production_tasks t where t.snapshot_id=s.id)),
  'missingJobs',(select count(*) from public.order_design_snapshots s where s.production_mode='automatic' and exists(select 1 from jsonb_array_elements_text(s.snapshot#>'{production,requiredJobTypes}') k where not exists(select 1 from public.customizer_render_jobs j where j.snapshot_id=s.id and j.job_type=k))),
  'missingOutputs',(select count(*) from public.customizer_render_jobs j join public.order_design_snapshots s on s.id=j.snapshot_id where j.status='completed' and (
   (j.job_type='print_pdf' and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id='all' and r.format='pdf')) or
   (j.job_type='print_png' and exists(select 1 from jsonb_array_elements(s.snapshot#>'{production,template,pages}') p where coalesce((p->>'enabled')::boolean,true) and not exists(select 1 from public.customizer_render_outputs r where r.job_id=j.id and r.status='ready' and r.page_id=p->>'id' and r.format='png'))))),
  'stuckJobs',(select count(*) from public.customizer_render_jobs where status='processing' and lock_expires_at<now()),
  'staleSnapshots',(select count(*) from public.order_design_snapshots where production_mode='automatic' and render_status in ('pending','queued','processing') and created_at<now()-interval '30 minutes'),
  'manualRequired',(select count(*) from public.order_design_snapshots where render_status='manual_required'),
  'manualComplete',(select count(*) from public.order_design_snapshots where render_status='manual_complete'),
  'automaticComplete',(select count(*) from public.order_design_snapshots where production_mode='automatic' and render_status='completed')
 ));
$$;

do $$ declare fn text; begin
 foreach fn in array array[
  'public.enqueue_snapshot_render_job(uuid,text,text)','public.commit_snapshot_render_result(uuid,uuid,jsonb)',
  'public.mark_snapshot_render_processing(uuid,uuid)','public.fail_snapshot_render_job(uuid,uuid,text,text,boolean)',
  'public.production_storage_cleanup_candidates(integer)',
  'public.retry_production_work(text,uuid,uuid,text)','public.reconcile_production(integer)',
  'public.production_health()','public.production_queue_health()'
  ,'public.prepare_notification_delivery(uuid,uuid,jsonb)','public.record_notification_delivery(uuid,uuid,text)',
  'public.resolve_notification_delivery(uuid,uuid,boolean,text,text)'
  ,'public.complete_manual_production(uuid,uuid,text)'
  ,'public.invalidate_snapshot_output(uuid,text)'
 ] loop execute 'revoke all on function '||fn||' from public,anon,authenticated'; execute 'grant execute on function '||fn||' to service_role'; end loop;
end $$;

commit;
