-- An order render may update lifecycle/output fields, but the design that was
-- ordered must not be changed through a direct Supabase client call.
create or replace function public.protect_ordered_customization_design()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'ordered'
     and (to_jsonb(new) - array['status','order_id','preview_images','print_files','updated_at'])
       is distinct from
         (to_jsonb(old) - array['status','order_id','preview_images','print_files','updated_at']) then
    raise exception 'ordered customizations are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ordered_customization_design on public.product_customizations;
create trigger protect_ordered_customization_design
before update on public.product_customizations
for each row execute function public.protect_ordered_customization_design();
