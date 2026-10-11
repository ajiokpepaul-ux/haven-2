# Haven Global — Phase 2 build

**Brand:** Haven — Stay anywhere. Feel safer everywhere.  
**Business model:** proposed 5% host commission on the accommodation subtotal.  
**Status:** development build. Some backend flows are implemented, but live payments, identity checks, email delivery and scheduled jobs require your own provider accounts, secrets and testing. Do not accept real guests or money until the production checklist is completed.

This package builds on the original Haven starter. The new SQL migration is designed to handle both cases: the original schema already created tables, or the earlier script stopped at `profiles` with `42P07 relation already exists`. It does not drop tables or delete existing data.

## 1. Connect your Supabase project

1. Extract the ZIP.
2. Open `config.js` and paste your Supabase Project URL and **publishable** key:

   ```js
   window.HAVEN_CONFIG = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     publishableKey: "sb_publishable_YOUR_KEY"
   };
   ```

   Older projects may use the public `anon` key. Never put a `sb_secret_...` key, service-role key, database password or payment secret in browser code.

3. In Supabase, open **SQL Editor → New query**.
4. Open `supabase/migrations/20261011_haven_phase2.sql` from this ZIP, copy the entire file into the query, and click **Run**.
5. Check **Table Editor**. The core tables should include `profiles`, `properties`, `property_evidence`, `bookings`, `reviews`, `safety_preferences`, `safety_checkins`, `waitlist`, plus `property_verifications`, `payment_events` and `safety_alert_log`.
6. Do **not** rerun `supabase/schema.sql` over an existing database. The migration is the upgrade path.

If the migration reports an error, stop and share the exact error. Do not drop `profiles` or reset the project.

## 2. Preview the website

Run a local server inside the extracted folder:

```bash
python -m http.server 8000
```

Open `http://localhost:8000`. Set that URL in Supabase **Authentication → URL Configuration** for local testing. Add your eventual HTTPS domain before production. The page still shows explicitly labelled sample stays if no published database listings exist.

## 3. What this phase implements

### Accounts and host listings
- Supabase email/password sign-up and sign-in.
- Profile creation trigger and safer profile column permissions.
- Host listing drafts saved to Supabase.
- Optional cover photo upload to the public listing-image bucket, with per-host upload paths.
- Separate private property-evidence bucket and evidence metadata table.
- Hosts cannot self-mark a property as verified or publish it through the normal client policies.

### Booking requests
- Booking request goes through `request_booking()` in PostgreSQL, not a browser-supplied total.
- Server-side subtotal and 5% commission arithmetic.
- Row lock plus date-overlap checks to reduce double booking.
- Host accept/decline through `respond_to_booking()`.
- Guest cancellation for unpaid requests through `cancel_booking()`.
- Guest/host booking dashboard.

A host still needs to approve a listing before it becomes public. The migration intentionally does not make all drafts public automatically.

### Payments and payouts (Stripe Connect scaffolding)
- `start-host-onboarding` creates/continues a connected-account onboarding link.
- `create-checkout` uses the saved booking totals and a 5% application fee; it does not trust an amount supplied by the browser.
- `stripe-webhook` verifies Stripe's signature and records paid checkout events idempotently. It must be deployed with `--no-verify-jwt` because Stripe authenticates using its signature, not a Supabase user JWT.

These functions are **not active until deployed and configured**. You must have a Stripe account that supports the intended marketplace and connected-account countries, complete platform onboarding, test Connect payouts, configure webhook events and test refunds/disputes. Country and currency availability vary; the code cannot override provider eligibility. Test mode first.

### Verification and trust
- Verification case workflow table with separate identity/property review statuses.
- Private storage bucket for room-level evidence.
- Host users cannot change reviewer decisions through client policies.

A real identity-verification vendor and a human moderation/review process are not magically supplied by the database. Choose a vendor available in your launch countries, integrate its server-side API/webhooks, define review standards, and staff the review queue before using a “verified” label publicly. Never upload sensitive identity documents to the public image bucket.

### HavenCheck
- User-controlled check-in intervals and consent record saved to Supabase.
- `start_havencheck()` creates the next check-in for an accepted booking during its stay dates.
- `havencheck-worker` sends an email reminder when due, then can notify an explicitly consented trusted contact by email after a 15-minute grace period.
- The worker logs sent/failed/skipped alerts. It does **not** automatically call police or emergency services. SMS is not implemented in this phase.

Real delivery requires deploying the worker, setting a Resend email account and scheduling the function. A missed check-in is not proof of an emergency; use careful wording, retries, support review and clear local emergency guidance.

### Global foundations
- Per-listing currency, profile locale/time zone fields, ISO country code and `Intl.NumberFormat` display.
- Currency is displayed as stored; **no automatic foreign-exchange conversion** is performed.
- Terms, privacy, consumer protection, tax, accessibility, host licensing and support requirements must be reviewed for each launch country. These are operational/legal tasks, not a code toggle.

## 4. Deploy the Edge Functions

Install the Supabase CLI and sign in, then link this folder to your project. Do not paste secret keys into source files.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy start-host-onboarding
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy havencheck-worker --no-verify-jwt
```

`havencheck-worker` uses its own long random bearer secret because it is called by a scheduler. Keep that secret private. Configure function secrets from your terminal (replace values locally; never commit them):

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_REPLACE_ME
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
supabase secrets set SITE_URL=http://localhost:8000
supabase secrets set SITE_ORIGIN=http://localhost:8000
supabase secrets set RESEND_API_KEY=re_REPLACE_ME
supabase secrets set HAVEN_EMAIL_FROM="Haven <alerts@your-verified-domain.example>"
supabase secrets set HAVENCHECK_WORKER_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
```

Use the actual production HTTPS URL and a sender domain verified with your email provider before production. Set `SITE_ORIGIN` to your actual site origin. Do not use a real payment key until test mode and the webhook have been tested.

### Stripe webhook

In Stripe test mode, add endpoint:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhook`

Subscribe to `checkout.session.completed` and `checkout.session.expired`, then save the signing secret as `STRIPE_WEBHOOK_SECRET`. Test with Stripe test cards and a connected account that has completed onboarding. Do not switch to live mode until payout, cancellation, refunds, chargebacks and reconciliation have been reviewed.

### Schedule HavenCheck

After deploying the worker, use Supabase **Cron** (or a trusted external scheduler) to call the worker every five minutes. Send this header:

`Authorization: Bearer YOUR_HAVENCHECK_WORKER_SECRET`

The scheduler URL is:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/havencheck-worker`

Do not expose the worker secret in the website. Test with a test user and a test check-in before enabling real contacts.

## 5. Test the flows in this order

1. Sign up with a test email; confirm it if email confirmation is enabled.
2. Sign in and create a listing draft with a small test image.
3. In Supabase Table Editor, confirm the listing is a `draft`; it should not appear publicly.
4. For development only, have an authorized admin publish a test property and make sure verification fields reflect actual review. Do not label fake/sample data verified.
5. Request a booking using dates, then try the same overlapping dates again. The second request should be rejected.
6. Sign in as the host and accept/decline the request.
7. Test connected-account onboarding and Checkout in provider test mode; verify the webhook updates `payment_status` only after a signed event.
8. Test HavenCheck reminder and trusted-contact email using addresses you control.
9. Review Supabase Security Advisor, access policies, backups and logs.

## 6. Important limits before launch

This is a working development foundation, **not a certified or production-ready global booking business**. Payment provider eligibility, real property verification, human safety escalation, refunds/disputes, tax treatment, country-specific legal requirements, rate limiting, anti-fraud controls, monitoring, incident response and restore-tested backups still need real-world setup and independent review. Do not claim a property, host, identity or inspection is verified unless the checks actually happened.

## Files

- `index.html`, `styles.css`, `app.js` — responsive front end and account/booking/dashboard flows.
- `config.js`, `config.example.js` — browser-safe Supabase configuration.
- `supabase/schema.sql` — original starter schema for reference only.
- `supabase/migrations/20261011_haven_phase2.sql` — idempotent upgrade/bootstrap migration.
- `supabase/functions/start-host-onboarding/` — Stripe Connect onboarding link.
- `supabase/functions/create-checkout/` — server-calculated 5% marketplace checkout.
- `supabase/functions/stripe-webhook/` — signed payment event handler.
- `supabase/functions/havencheck-worker/` — consent-based email reminder/escalation worker.
- `docs/PRODUCTION_CHECKLIST.md` — pre-launch checklist.

## Property detail, photo gallery and booking experience upgrade

This build removes the illustrative sample stays from the public listing grid. The site now displays published database listings only, provides a property detail view, supports a multi-photo gallery (including interiors), captures full descriptions/amenities/house rules, and shows a date-based stay estimate before a booking request.

### Apply the gallery database change

Before deploying this frontend, open the Supabase SQL Editor for your project and run the contents of `supabase/migrations/20261011_haven_property_gallery_upgrade.sql`. This adds `gallery_urls` to `properties` and grants the frontend access to that column. It is safe to run more than once.

### Upload interior photos

Sign in to Haven, use **Become a host**, fill in the property description and room details, and select multiple JPG/PNG/WebP photos (up to 12, each under 10 MB). Include the bedrooms, bathrooms, kitchen, living room and any outdoor areas. A saved listing remains a draft until it is reviewed and published. Existing listings with only one cover photo will show only that photo until more are uploaded.

### Booking payments

The guest requests dates first. The host accepts the request, then the guest uses **Continue to payment** in Trips & booking requests. Checkout is hosted by Stripe; do not add raw card fields to the Haven page. The Stripe Connect Edge Functions in this project are scaffolding and require Stripe account setup, Supabase secrets, function deployment, webhook setup and end-to-end testing before they can accept real money. Keep Stripe keys and the Supabase service-role key out of `config.js` and browser code. Use Stripe test mode first.

### Publish the updated website

1. Extract this ZIP.
2. Commit the updated `index.html`, `app.js`, `styles.css`, `README.md`, and new SQL migration into the GitHub repository connected to Vercel.
3. Run the SQL gallery migration in Supabase.
4. Wait for Vercel to finish deploying, then hard-refresh the site (Ctrl+F5).
5. Test with a real host account, a draft property with multiple photos, manual review/publishing, a separate guest account, a booking request, host acceptance, and Stripe test checkout.

Removing sample listings does not create real listings automatically; at least one actual property must be reviewed and published to appear on the site.
