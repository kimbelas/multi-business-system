import { createClient } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

/**
 * The owner's landing screen, and the first thing in this app that is actually its own.
 *
 * Everything shown here comes back through RLS with the anon key - no service role, no
 * bypass. That is deliberate and it is the test: if the policies are wrong, this page is
 * empty rather than showing data it should not. A screen that renders because a policy
 * allowed it is the only kind worth trusting.
 */

interface BranchRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface BusinessRow {
  id: string;
  name: string;
  type: "laundry" | "spa" | "skincare";
  branches: BranchRow[];
}

const TYPE_LABEL: Record<BusinessRow["type"], string> = {
  laundry: "Laundry",
  spa: "Spa",
  skincare: "Skin care",
};

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /*
   * One query, joined. Three round trips - businesses, then branches per business - would be
   * three RLS evaluations and three latencies on the screen someone opens first.
   */
  const { data, error } = await supabase
    .from("businesses")
    .select("id, name, type, branches (id, name, is_active)")
    .order("name");

  const businesses = (data ?? []) as BusinessRow[];

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Belas Group</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm underline underline-offset-4">
            Sign out
          </button>
        </form>
      </header>

      {error && (
        <p role="alert" className="mt-8 text-sm text-destructive">
          Could not load your businesses: {error.message}
        </p>
      )}

      {!error && businesses.length === 0 && (
        /*
         * Not a generic empty state. An account with no membership signs in perfectly and
         * reads nothing, because owned_org_ids() is empty - so the useful message names that
         * cause rather than suggesting the data does not exist.
         */
        <div className="mt-8 rounded-lg border border-dashed p-6">
          <p className="font-medium">No businesses you can reach</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account has no membership yet. Someone with owner access has to grant one before
            anything here is visible to you.
          </p>
        </div>
      )}

      <ul className="mt-8 flex flex-col gap-4">
        {businesses.map((business) => (
          <li key={business.id} className="rounded-lg border p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-medium">{business.name}</h2>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {TYPE_LABEL[business.type]}
              </span>
            </div>

            <ul className="mt-3 flex flex-col gap-1.5">
              {business.branches.length === 0 && (
                <li className="text-sm text-muted-foreground">No branches yet</li>
              )}
              {business.branches.map((branch) => (
                <li key={branch.id} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${
                      branch.is_active ? "bg-emerald-500" : "bg-muted-foreground"
                    }`}
                  />
                  {branch.name}
                  {!branch.is_active && <span className="text-muted-foreground">(inactive)</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-xs text-muted-foreground">
        Everything above was read with the anon key through row level security. Nothing on this page
        bypasses a policy.
      </p>
    </main>
  );
}
