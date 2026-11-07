-- Atomic commit for employee annual-leave bids.
-- Run this once in the Supabase SQL Editor for the Annual Leave project.

create or replace function public.commit_employee_bid(
  p_invite_id uuid,
  p_payload jsonb,
  p_expected_updated_at timestamptz,
  p_employee_id text,
  p_office_id integer,
  p_leave_year integer,
  p_bidding_round integer,
  p_weeks integer[],
  p_submitted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_updated_at timestamptz;
begin
  -- Lock both records so simultaneous bids cannot overwrite one another
  -- or consume the same invite twice.
  perform 1
    from public.annual_leave_bid_invites
   where id = p_invite_id
     and employee_id = p_employee_id
     and office_id = p_office_id
     and leave_year = p_leave_year
     and bidding_round = p_bidding_round
     and status = 'open'
   for update;

  if not found then
    raise exception 'This bidding link has expired or has already been used.';
  end if;

  select updated_at
    into current_updated_at
    from public.annual_leave_app_state
   where id = 'main'
   for update;

  if not found or current_updated_at is distinct from p_expected_updated_at then
    raise exception 'The master board changed while you were submitting. Please reopen your link and submit again.';
  end if;

  update public.annual_leave_app_state
     set payload = p_payload,
         updated_at = p_submitted_at
   where id = 'main';

  update public.annual_leave_bid_invites
     set status = 'submitted',
         submitted_at = p_submitted_at
   where id = p_invite_id
     and status = 'open';

  if not found then
    raise exception 'This bidding link has already been used.';
  end if;

  insert into public.annual_leave_bid_submissions
    (invite_id, employee_id, office_id, leave_year, bidding_round, weeks, submitted_at)
  values
    (p_invite_id, p_employee_id, p_office_id, p_leave_year, p_bidding_round, p_weeks, p_submitted_at);
end;
$$;

revoke all on function public.commit_employee_bid(uuid,jsonb,timestamptz,text,integer,integer,integer,integer[],timestamptz) from public, anon, authenticated;
grant execute on function public.commit_employee_bid(uuid,jsonb,timestamptz,text,integer,integer,integer,integer[],timestamptz) to service_role;
