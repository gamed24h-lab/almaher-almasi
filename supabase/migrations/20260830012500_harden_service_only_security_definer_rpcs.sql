-- Final pre-production security hardening.
-- These SECURITY DEFINER RPCs are invoked by the Cloudflare Worker with the
-- Supabase service-role key. They must not be directly executable through
-- PostgREST by anon or authenticated clients.

revoke execute on function public.almaher_apply_runtime_environment() from public, anon, authenticated;
grant execute on function public.almaher_apply_runtime_environment() to service_role;

revoke execute on function public.almaher_assign_seat_atomic(uuid,text,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.almaher_assign_seat_atomic(uuid,text,text,uuid,uuid,text) to service_role;

revoke execute on function public.almaher_cancel_booking_settle_atomic(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.almaher_cancel_booking_settle_atomic(text,text,text,text,text,text,text,text) to service_role;

revoke execute on function public.almaher_refund_edit_atomic(uuid,numeric,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.almaher_refund_edit_atomic(uuid,numeric,text,text,text,text,text) to service_role;

revoke execute on function public.almaher_refund_reverse_atomic(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.almaher_refund_reverse_atomic(uuid,text,text,text,text) to service_role;

revoke execute on function public.almaher_room_assignment_fill_booking() from public, anon, authenticated;
grant execute on function public.almaher_room_assignment_fill_booking() to service_role;

revoke execute on function public.almaher_set_seat_state_atomic(uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.almaher_set_seat_state_atomic(uuid,text,text,text,text) to service_role;

revoke execute on function public.almaher_wallet_refund_atomic(text,text,numeric,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.almaher_wallet_refund_atomic(text,text,numeric,text,text,text,text,text,text) to service_role;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;
