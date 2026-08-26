-- Al Maher: keep cancellation + financial settlement in one PostgreSQL transaction.
-- Also align refund_method values with the UI/Worker contract.

alter table public.booking_refunds drop constraint if exists booking_refunds_refund_method_check;
alter table public.booking_refunds add constraint booking_refunds_refund_method_check
  check (refund_method in ('cash','bank_transfer','mada','card','same_method','wallet','other'));

create or replace function public.almaher_cancel_booking_settle_atomic(
  p_booking_number text,
  p_reason text,
  p_settlement_mode text,
  p_refund_method text,
  p_client_request_id text,
  p_actor_id text,
  p_actor_name text,
  p_actor_role text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  b public.bookings%rowtype;
  r public.booking_refunds%rowtype;
  w public.customer_wallets%rowtype;
  existing_r public.booking_refunds%rowtype;
  reason_text text;
  mode_text text;
  method_text text;
  client_key text;
  env_text text;
  paid_total numeric := 0;
  refunded_total numeric := 0;
  due_total numeric := 0;
  post_refunded numeric := 0;
  receipt_text text;
  new_fin text;
begin
  reason_text := btrim(coalesce(p_reason,''));
  mode_text := btrim(coalesce(p_settlement_mode,'none'));
  method_text := btrim(coalesce(p_refund_method,'cash'));
  client_key := coalesce(nullif(btrim(coalesce(p_client_request_id,'')),''),md5(random()::text||clock_timestamp()::text));

  if reason_text = '' then raise exception 'CANCEL_REASON_REQUIRED'; end if;
  if mode_text <> 'none' and mode_text <> 'direct_refund' and mode_text <> 'wallet' then raise exception 'INVALID_SETTLEMENT_MODE'; end if;
  if mode_text = 'direct_refund' and method_text <> 'cash' and method_text <> 'bank_transfer' and method_text <> 'mada' and method_text <> 'card' and method_text <> 'same_method' and method_text <> 'other' then raise exception 'INVALID_REFUND_METHOD'; end if;

  select * into b from public.bookings where booking_number=btrim(p_booking_number) for update;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  env_text := coalesce(b.data_environment,'training');

  select * into existing_r
  from public.booking_refunds
  where booking_id=b.id and metadata->>'client_request_id'=client_key
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok',true,'idempotent',true,'cancelled',true,'booking_number',b.booking_number,
      'settlement',jsonb_build_object('mode',case when existing_r.refund_method='wallet' then 'wallet' else 'direct_refund' end,'amount',existing_r.amount,'receipt_no',existing_r.receipt_no,'status',existing_r.status));
  end if;

  paid_total := greatest(coalesce(b.paid_amount,0),coalesce((b.snapshot->'finance'->>'grossPaidHistory')::numeric,0));
  select coalesce(sum(amount),0) into refunded_total from public.booking_refunds where booking_id=b.id and status='completed';
  due_total := greatest(0,paid_total-refunded_total);

  if due_total > 0.001 and mode_text='none' then raise exception 'SETTLEMENT_REQUIRED:%',due_total; end if;
  if due_total <= 0.001 then mode_text := 'none'; end if;

  if coalesce(b.status,'') <> 'cancelled' and coalesce(b.status,'') <> 'canceled' and coalesce(b.status,'') <> 'ملغي' then
    perform public.almaher_update_booking_atomic(
      b.booking_number,
      jsonb_build_object('status','cancelled','paid_amount',coalesce(b.paid_amount,0),'snapshot',coalesce(b.snapshot,'{}'::jsonb)||jsonb_build_object('cancellationReason',reason_text,'cancelledAt',now(),'cancelledBy',coalesce(p_actor_name,p_actor_id,''),'cancellationSettlementMode',mode_text)),
      null,
      jsonb_build_object('id',p_actor_id,'name',p_actor_name,'role',p_actor_role)
    );
  end if;

  update public.bookings set cancellation_reason=reason_text,last_modified_at=now(),last_modified_by=coalesce(p_actor_name,p_actor_id,last_modified_by) where id=b.id;
  update public.seat_assignments set status='released',updated_at=now() where booking_id=b.id and (status='assigned' or status='hold');
  update public.room_assignments set status='cancelled',cancelled_at=now(),cancellation_reason=reason_text where booking_id=b.id and status='assigned';

  if mode_text='direct_refund' or mode_text='wallet' then
    receipt_text := 'REF-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISSMS')||'-'||upper(substr(md5(client_key),1,4));
    insert into public.booking_refunds(receipt_no,booking_id,booking_number,branch_id,customer_name,customer_phone,amount,paid_amount_snapshot,previous_refunded_amount,reason,refund_method,customer_ack_name,cancel_booking,status,requested_by,requested_by_id,requested_at,decided_by,decided_by_id,decided_at,completed_by,completed_by_id,completed_at,metadata,created_at,updated_at)
    values(receipt_text,b.id,b.booking_number,b.branch_id,b.customer_name,b.customer_phone,due_total,paid_total,refunded_total,'إلغاء الحجز — '||reason_text,case when mode_text='wallet' then 'wallet' else method_text end,b.customer_name,false,'completed',p_actor_name,p_actor_id,now(),p_actor_name,p_actor_id,now(),p_actor_name,p_actor_id,now(),jsonb_build_object('client_request_id',client_key,'operation','cancel_booking_settle','settlement_mode',mode_text,'cancellation_reason',reason_text),now(),now())
    returning * into r;

    if mode_text='direct_refund' then
      insert into public.transactions(booking_id,branch_id,transaction_type,amount,payment_method,reference_no,notes,created_by,status,idempotency_key,data_environment)
      values(b.id,b.branch_id,'refund',due_total,method_text,'RFND-'||r.receipt_no,'استرداد إلغاء الحجز — '||reason_text,p_actor_name,'posted','cancel-refund-'||client_key,env_text)
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    end if;

    if mode_text='wallet' then
      if coalesce(b.customer_identity,'')='' then raise exception 'CUSTOMER_IDENTITY_REQUIRED_FOR_WALLET'; end if;
      insert into public.customer_wallets(customer_identity,customer_phone,customer_name,data_environment)
      values(b.customer_identity,b.customer_phone,b.customer_name,env_text)
      on conflict (customer_identity,data_environment) do update set customer_phone=excluded.customer_phone,customer_name=excluded.customer_name,updated_at=now()
      returning * into w;

      insert into public.wallet_transactions(wallet_id,booking_id,transaction_type,amount,status,reason,reference_no,idempotency_key,created_by,metadata,data_environment)
      values(w.id,b.id,'credit',due_total,'posted','إلغاء الحجز — '||reason_text,'WAL-'||r.receipt_no,'cancel-wallet-'||client_key,p_actor_name,jsonb_build_object('refund_id',r.id,'refund_receipt_no',r.receipt_no,'booking_number',b.booking_number,'cancellation_reason',reason_text),env_text)
      on conflict (idempotency_key) where idempotency_key is not null do nothing;
    end if;
  end if;

  post_refunded := refunded_total;
  if mode_text='direct_refund' or mode_text='wallet' then post_refunded := post_refunded + due_total; end if;

  if paid_total<=0 then new_fin:='unpaid';
  elsif post_refunded>=paid_total-0.001 then new_fin:='refunded';
  elsif post_refunded>0 then new_fin:='partially_refunded';
  elsif paid_total>=coalesce(b.total_price,0)-0.001 and coalesce(b.total_price,0)>0 then new_fin:='paid';
  else new_fin:='partial'; end if;

  update public.bookings set financial_status=new_fin,last_modified_at=now() where id=b.id;

  insert into public.activity_events(actor_id,actor_name,actor_role,branch_id,action,entity_type,entity_id,metadata)
  values(p_actor_id,p_actor_name,p_actor_role,b.branch_id,'booking_cancelled_settled','booking',b.id::text,jsonb_build_object('booking_number',b.booking_number,'reason',reason_text,'settlement_mode',mode_text,'amount',due_total,'refund_method',case when mode_text='wallet' then 'wallet' else method_text end,'receipt_no',r.receipt_no,'client_request_id',client_key,'financial_status',new_fin));

  return jsonb_build_object('ok',true,'cancelled',true,'booking_number',b.booking_number,'reason',reason_text,'financial_status',new_fin,
    'settlement',jsonb_build_object('mode',mode_text,'amount',case when mode_text='none' then 0 else due_total end,'receipt_no',r.receipt_no,'status',case when mode_text='none' then 'none' else 'completed' end,'wallet_id',w.id));
end;
$$;

create index if not exists booking_refunds_client_request_idx
  on public.booking_refunds ((metadata->>'client_request_id'))
  where metadata ? 'client_request_id';
