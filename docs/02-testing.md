# Testing

Four suites, three targets. Each answers a question the others cannot.

|                | Command                  | Runs against            | Needs                 |
| -------------- | ------------------------ | ----------------------- | --------------------- |
| Unit           | `pnpm test`              | nothing external        | —                     |
| End-to-end     | `pnpm test:e2e`          | local `next dev`        | —                     |
| Deployed smoke | `pnpm test:e2e:deployed` | a deployed build        | `PLAYWRIGHT_BASE_URL` |
| Policies       | `pnpm test:rls`          | a real Supabase project | three credentials     |

`pnpm test` and `pnpm test:e2e` are the ones that run on every push. The other two write to, or
assert against, live infrastructure, so they are opt-in — see **CI** below.

## The rule that governs all of them

**A test that cannot run must skip, not pass.** Every suite here that depends on something
external checks for it and skips loudly when it is missing. A green run against no database, or
against a page that never loaded its JavaScript, is worse than no suite at all: it converts an
absence of information into a claim.

Both of those have already happened in this repo. `smoke.spec.ts` passed for days while `next dev`
returned 403 for every client chunk and nothing on any page hydrated, because HTTP 200 and a
visible `<body>` are both true of a page with no JavaScript running. And `pnpm test:rls` with no
credentials reports **27 skipped**, not 27 passed — check for that number when you expect it to
have run.

## Unit — `pnpm test`

Hermetic and fast. No network, no database, no browser beyond jsdom. Money arithmetic, the
keypad reducer, chart geometry, and the design tokens read straight out of `globals.css`.

`tests-e2e` and `tests-rls` are excluded explicitly. Both hold files ending in shapes vitest
would try to run.

## End-to-end — `pnpm test:e2e`

Playwright against a local dev server it starts itself, so a fresh clone runs the suite with one
command. Everything except `deployed.spec.ts` drives `/preview`, which renders both screens with
invented figures and 404s outside development.

The base URL is `127.0.0.1`, and `next.config.ts` must keep naming it in `allowedDevOrigins`:
Next 16 counts `127.0.0.1` and `localhost` as different hosts and returns 403 for every
`/_next/static/chunks/*.js` otherwise. The whole suite then runs against a page that never
hydrates and most of it still passes.

## Deployed smoke — `pnpm test:e2e:deployed`

```bash
PLAYWRIGHT_BASE_URL=https://bizdesk.<subdomain>.workers.dev pnpm test:e2e:deployed
```

With `PLAYWRIGHT_BASE_URL` set, Playwright starts no server — the point is to test the thing
that is already running — and the preview-driven specs skip themselves.

`deployed.spec.ts` asserts what has to be true of a build anyone can reach: an unauthenticated
request lands on `/login` and carries `next=`, the login page asks for an email and a password
and offers no signup, nothing errors in the console, and — on a deployed target only — the design
preview is **gone**. That last one is the interesting assertion. `/preview` is guarded twice, by
`notFound()` in the route and by the middleware's `isDevPreview`, and the test accepts either a
404 or a login redirect. What it refuses is a page of invented pesos on a URL anyone can reach.

## Policies — `pnpm test:rls`

The five-persona suite. This is the gate the plan names: _the five-persona suite passes before
any screen shows a peso._

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
pnpm test:rls
```

Pass them on the command line rather than putting them in a file. The service role key bypasses
RLS completely.

### The personas

|            | Grant                      | What it proves                                        |
| ---------- | -------------------------- | ----------------------------------------------------- |
| `owner`    | org-wide, `branch_id` null | reads and manages the whole org                       |
| `managerA` | branch A                   | reads branch A, cannot create a branch                |
| `staffA`   | branch A                   | same read scope; cannot grant itself a role           |
| `staffB`   | branch B                   | cannot see branch A, by list **or** by naming its id  |
| `outsider` | none                       | signs in perfectly and reads nothing                  |
| `anon`     | no session                 | reads nothing from any table, cannot call the helpers |

`outsider` is the persona that matters most and is easiest to leave out. An account with no
membership is not broken — it is unauthorized — and the app has to say so rather than showing an
empty dashboard that looks like missing data. `src/app/page.tsx` names that cause in its empty
state for exactly this reason.

`staffB` carries the assertion worth copying elsewhere: not only "what does a list return" but
"what happens when someone asks for a specific row they should not have". A policy that filters
lists but not point reads leaks to anyone who guesses an id.

The suite also holds the **42P17 regression** — the owner reading `businesses` joined to
`branches`, which is the query the landing screen runs and the one that recursed forever when
two policies subqueried each other's tables.

### Why a real project, and what that costs

RLS is the only authorization layer, so a policy suite that passes against a substitute proves
the substitute. The recursion bug was a property of the deployed policies, not of the schema on
paper, and nothing short of PostgREST in front of real Postgres would have caught it.

The cost is that the suite **writes**. It is contained:

- everything it creates lives under one organization whose name carries a run id;
- teardown deletes by the ids it recorded and nothing else — no unfiltered `delete`, no cleanup
  by name pattern that could catch a real row;
- teardown runs even when assertions fail, and after a half-built fixture;
- the fixture is built with the service role on purpose, so a policy bug shows up as a failed
  assertion rather than as a broken setup.

It still creates and deletes real auth users. **Point it at a development project.** PostgREST is
not a transaction and nothing here can be rolled back.

One detail that would silently invalidate the whole suite: every client is created with
`persistSession: false`. The default writes the session to a shared store, so signing in the
second persona replaces the first and all five clients act as the same user. Every assertion
would pass while testing one persona five times, and nothing would look wrong.

## CI

`check` and `bundle` run on every push and pull request.

`rls` and `deployed` run on `workflow_dispatch` or the Monday schedule only. A suite that writes
to the project on every commit is a suite somebody eventually points at production by accident,
and there is no point asserting against a deployment a push has not produced yet. Both skip with
a warning rather than failing when their secrets are absent, so a fork can still run CI.

The `rls` job logs the target **host** before it runs — never the key. Pointing it at the wrong
project is the one mistake that matters, and a log line naming it is the cheapest guard.

Secrets it wants, beyond the four the deploy already needs:

- `SUPABASE_SERVICE_ROLE_KEY` — runtime and CI only, never in a build environment
- `DEPLOYED_URL` — the Worker URL the deployed smoke runs against

## Verifying what is actually deployed

**Ask curl, not a browser.** The Worker serves HTML with
`cache-control: private, no-cache, no-store, must-revalidate`, but an earlier deploy did not,
and a response cached before those headers existed is still a response a browser will show. A
stale tab reported the create-next-app starter page long after the login screen had shipped,
which sent a diagnosis down the wrong path - including one sentence in the commit that fixed
the real problem, `3a78e9b`, claiming the deployed build predated the middleware. It did not.

```bash
U=https://bizdesk.<subdomain>.workers.dev
curl -s -o /dev/null -w "status=%{http_code} final=%{url_effective}\n" -L "$U/"
curl -s -L "$U/" | grep -o "<title>[^<]*</title>"
```

An unauthenticated `/` that ends at `/login?next=%2F` with a `Sign in` title is a build with the
middleware in it. The starter page has neither.

## Why a deploy has not happened

`deploy.yml` fires on `workflow_run` for CI with a `success` conclusion, so **anything that
fails CI silently stops the deploy** - and the deploy failing is not what you see. What you see
is a URL serving an older build, which looks like nothing happened rather than like something
broke.

That is what happened here: `origin/main` failed `pnpm format:check` on 35 files, the Format
step runs third in the `check` job, and CI had been red on every push since. Confirmed by
extracting the pushed tree with `git archive origin/main` and running prettier over it, which is
the way to check this without waiting for a CI run.

So when a change is missing from the deployed build, in order:

1. `git rev-list --left-right --count origin/main...HEAD` — is it even pushed?
2. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` locally — all four, because
   CI runs all four and three of them passing is not a green build.
3. The Actions tab — CI first, then Deploy. A skipped Deploy means CI was not green.
4. `curl` the URL, per above, rather than trusting a tab.
