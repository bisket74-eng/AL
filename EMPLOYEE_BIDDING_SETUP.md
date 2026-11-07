# Employee self-bidding feature — deployment notes

The employee bidding feature is staged on branch `employee-bidding-feature`. It is not live on GitHub Pages yet.

## Files added or changed

- `employee-bid.html` — employee-facing board and week selection page.
- `supabase/functions/employee-bidding/index.ts` — Edge Function for issuing personal links, reading a scoped board view, validating bids, and saving submissions.
- `index.html` — adds the admin **Send employee bid link** control to the existing board page.

## Existing database setup

The feature expects the two tables created by the Employee Bidding Supabase Setup SQL:

- `annual_leave_bid_invites`
- `annual_leave_bid_submissions`

It also reads and updates the existing `annual_leave_app_state` singleton row.

## Deploy the Edge Function

Deploy the function with the name `employee-bidding`, using the source file at:

`supabase/functions/employee-bidding/index.ts`

The Supabase project already provides the Edge Function environment values `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must remain server-side and must never be added to either HTML file.

Using the Supabase CLI from a local clone:

```sh
supabase login
supabase link --project-ref ghnuahsovbpyzrjvbylp
supabase functions deploy employee-bidding
```

## Publish the website files

After review and testing, merge `employee-bidding-feature` into `main`. GitHub Pages then publishes `index.html` and `employee-bid.html` from the main branch.

## Initial test checklist

1. Sign in to the admin app.
2. Open one board and choose the intended round.
3. Tap **Send employee bid link**, choose the next employee, and create the link.
4. Open the link in a private/incognito browser window.
5. Confirm the employee sees only their assigned board and cannot access admin controls.
6. Confirm blocked and already-taken weeks cannot be selected.
7. Submit a valid test bid and verify it appears in the admin board and the submission table.
8. Confirm the link cannot be used a second time.
9. Confirm issuing a new link for the same board/year/round invalidates the previous open link.

Do not use this for official bidding until the Edge Function is deployed and the end-to-end tests pass.
