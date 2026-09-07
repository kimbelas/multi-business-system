import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Fixture, rlsEnv, setUpFixture } from "./harness";

/**
 * The money policies, asked of a real project — card 0003, and the spec calls it non-negotiable.
 *
 * The sentence the whole system rests on is "every peso is attributed to a person, a branch and a
 * time", and the sentence the *owner* rests on is that a staff member cannot see what the branch
 * took today. Both are policies, not screens, so both are asserted here through the anon key with a
 * persona's session — never through a component, and never through the service-role client, which
 * bypasses everything and would prove nothing.
 *
 * What this file will not do is assert an absence with a count. `toHaveCount(0)` prints "expected 0,
 * received 1"; `toEqual([])` prints the row it found, and on 2026-09-03 that difference is what
 * identified a cause in thirty seconds instead of a re-run. Every negative here compares a list.
 */

const env = rlsEnv();
const describeRls = env ? describe : describe.skip;

const amounts = (rows: { amount: string | number }[] | null) =>
  (rows ?? []).map((r) => Number(r.amount)).sort((a, b) => a - b);

describeRls("money policies", () => {
  let f: Fixture;

  /** Ids recorded as they are created, so the assertions name rows rather than guess at them. */
  const tx: Record<string, string> = {};

  beforeAll(async () => {
    f = await setUpFixture(env!);

    // Three sales across two branches. The shape is the whole test: staffA and managerA share
    // branch A, so "staff see their own" and "managers see the branch" give different answers on
    // the same rows; and staffB is at branch B, so a manager's reach is bounded by branch and not
    // by organisation. A policy that confused the two would satisfy one of these and fail another.
    for (const [key, persona, branch, amount] of [
      ["staffA", "staffA", f.branchA, 100],
      ["staffB", "staffB", f.branchB, 250],
      ["managerA", "managerA", f.branchA, 500],
    ] as const) {
      const { data, error } = await f.personas[persona].db
        .from("transactions")
        .insert({
          branch_id: branch,
          staff_id: f.personas[persona].userId,
          amount,
          payment_method: "cash",
          description: `money-suite ${key}`,
        })
        .select("id")
        .single();
      expect(error, `${persona} could not record a sale at their own branch`).toBeNull();
      tx[key] = (data as { id: string }).id;
    }
  }, 120_000);

  afterAll(async () => {
    /*
     * Delete what this file created before the fixture deletes what it created.
     *
     * `transactions` has no delete policy - deliberately, it is an audit trail - so no persona can
     * remove these rows, and a branch cannot be dropped while one references it. That is why the
     * harness exposes `admin`: not to assert with, but to clean up the things RLS is designed to
     * make permanent. Order follows the foreign keys.
     */
    if (f) {
      const branches = [f.branchA, f.branchB];
      for (const table of ["laundry_orders", "appointments", "daily_closes", "attendance"]) {
        await f.admin.from(table).delete().in("branch_id", branches);
      }
      await f.admin.from("transactions").delete().in("branch_id", branches);
    }

    const leaked = (await f?.teardown()) ?? [];
    expect(leaked, "the fixture teardown left rows behind in a real project").toEqual([]);
  }, 120_000);

  // ------------------------------------------------------------------ insert

  describe("recording a sale", () => {
    it("refuses a sale entered under somebody else's name", async () => {
      // This is what makes attribution true rather than aspirational. A staff member who can post
      // `staff_id` of a colleague can move a peso onto them, and no screen would show it.
      const { error } = await f.personas.staffA.db.from("transactions").insert({
        branch_id: f.branchA,
        staff_id: f.personas.staffB.userId,
        amount: 999,
      });
      expect(error?.code, "staffA posted a sale as staffB").toBe("42501");
    });

    it("refuses a sale at a branch the person has no grant for", async () => {
      // staffA holds branch A only; branch B is where staffB works.
      const { error } = await f.personas.staffA.db.from("transactions").insert({
        branch_id: f.branchB,
        staff_id: f.personas.staffA.userId,
        amount: 999,
      });
      expect(error?.code, "staffA recorded a sale at branch B").toBe("42501");
    });

    it("refuses a sale in an organisation nobody here belongs to", async () => {
      const { error } = await f.personas.owner.db.from("transactions").insert({
        branch_id: f.otherBranchId,
        staff_id: f.personas.owner.userId,
        amount: 999,
      });
      expect(error?.code, "the owner reached into another tenancy").toBe("42501");
    });
  });

  // ------------------------------------------------------------------ select

  describe("reading transactions", () => {
    it("shows a staff member their own rows and nobody else's", async () => {
      const { data } = await f.personas.staffA.db.from("transactions").select("amount");
      expect(amounts(data), "staffA saw a colleague's sale").toEqual([100]);
    });

    it("shows the other staff member the mirror image", async () => {
      // Asserted separately rather than assumed by symmetry: a policy comparing against the wrong
      // side of the join passes one of these two and fails the other.
      const { data } = await f.personas.staffB.db.from("transactions").select("amount");
      expect(amounts(data), "staffB saw a colleague's sale").toEqual([250]);
    });

    it("shows a manager their branch and not the one next door", async () => {
      const { data } = await f.personas.managerA.db.from("transactions").select("amount");
      expect(amounts(data), "a manager saw another branch's takings").toEqual([100, 500]);
    });

    it("shows the owner everything in the organisation", async () => {
      const { data } = await f.personas.owner.db.from("transactions").select("amount");
      expect(amounts(data)).toEqual([100, 250, 500]);
    });

    it("shows an outsider nothing", async () => {
      const { data } = await f.personas.outsider.db
        .from("transactions")
        .select("amount,description");
      expect(data ?? [], "an outsider read the org's takings").toEqual([]);
    });

    it("shows no session nothing", async () => {
      const { data } = await f.anon.from("transactions").select("amount,description");
      expect(data ?? [], "an anonymous request read the org's takings").toEqual([]);
    });
  });

  // -------------------------------------------------------------- immutability

  describe("a transaction, once recorded", () => {
    it("cannot have its amount changed, even by the owner", async () => {
      const { error } = await f.personas.owner.db
        .from("transactions")
        .update({ amount: 1 })
        .eq("id", tx.staffA);
      expect(error?.message ?? "", "an amount was edited").toMatch(/immutable/i);
    });

    it("cannot have a tip moved onto somebody else", async () => {
      // The spec's trigger compared with `<>`, which is null against a null column and therefore not
      // true - so this exact edit would have gone through. `is distinct from` is why it does not.
      const { error } = await f.personas.owner.db
        .from("transactions")
        .update({ tip_recipient_staff_id: f.personas.owner.userId, tip_amount: 50 })
        .eq("id", tx.staffA);
      expect(error?.message ?? "", "a tip was reassigned after the fact").toMatch(/immutable/i);
    });

    it("cannot be voided by the staff member who entered it", async () => {
      const { error } = await f.personas.staffA.db
        .from("transactions")
        .update({ is_voided: true, void_reason: "changed my mind" })
        .eq("id", tx.staffA);
      // No rows matched rather than a refusal: the update policy simply does not admit staff, so
      // PostgREST reports success over zero rows. Assert on the row, not on the error.
      expect(error).toBeNull();
      const { data } = await f.personas.managerA.db
        .from("transactions")
        .select("is_voided")
        .eq("id", tx.staffA)
        .single();
      expect((data as { is_voided: boolean }).is_voided, "staff voided their own sale").toBe(false);
    });

    it("cannot be voided without a reason", async () => {
      // Branch A, deliberately. Pointed at staffB's sale this passed for the wrong reason: managerA
      // holds no grant at branch B, so the update matched zero rows, PostgREST reported success and
      // the trigger never ran. A test that cannot reach the code it is checking is the failure this
      // repository has now found six times.
      const { error } = await f.personas.managerA.db
        .from("transactions")
        .update({ is_voided: true, void_reason: "x" })
        .eq("id", tx.managerA);
      expect(error?.message ?? "").toMatch(/void_reason/i);
    });

    it("can be voided by a manager, with a reason, and then never unvoided", async () => {
      const { error: voidError } = await f.personas.managerA.db
        .from("transactions")
        .update({ is_voided: true, void_reason: "rang twice by mistake" })
        .eq("id", tx.managerA);
      expect(voidError).toBeNull();

      const { error: reverseError } = await f.personas.managerA.db
        .from("transactions")
        .update({ is_voided: false })
        .eq("id", tx.managerA);
      expect(reverseError?.message ?? "", "a void was reversed").toMatch(/cannot be reversed/i);
    });

    it("cannot be deleted by anyone", async () => {
      // There is no delete policy at all, so this is a no-op rather than an error. The row is the
      // assertion.
      await f.personas.owner.db.from("transactions").delete().eq("id", tx.managerA);
      const { data } = await f.personas.owner.db
        .from("transactions")
        .select("id")
        .eq("id", tx.managerA);
      expect((data ?? []).length, "a transaction was deleted").toBe(1);
    });
  });

  // ------------------------------------------------------------- daily_closes

  describe("the daily close", () => {
    it("is invisible to staff, so yesterday's expected cash cannot be read off it", async () => {
      const { error } = await f.personas.managerA.db.from("daily_closes").insert({
        branch_id: f.branchA,
        close_date: "2026-09-07",
        opening_float: 1000,
        expected_cash: 1600,
        declared_cash: 1600,
        counted_by: f.personas.managerA.userId,
        closed_by: f.personas.managerA.userId,
      });
      expect(error, "a manager could not close their own branch").toBeNull();

      const { data } = await f.personas.staffA.db
        .from("daily_closes")
        .select("expected_cash,declared_cash,variance");
      expect(data ?? [], "a staff member read the close").toEqual([]);
    });

    it("cannot be created by staff", async () => {
      const { error } = await f.personas.staffA.db.from("daily_closes").insert({
        branch_id: f.branchA,
        close_date: "2026-09-06",
        opening_float: 0,
        expected_cash: 0,
        declared_cash: 0,
        counted_by: f.personas.staffA.userId,
        closed_by: f.personas.staffA.userId,
      });
      expect(error?.code, "a staff member submitted a close").toBe("42501");
    });

    it("cannot be closed in somebody else's name", async () => {
      const { error } = await f.personas.managerA.db.from("daily_closes").insert({
        branch_id: f.branchA,
        close_date: "2026-09-05",
        opening_float: 0,
        expected_cash: 0,
        declared_cash: 0,
        counted_by: f.personas.managerA.userId,
        closed_by: f.personas.owner.userId,
      });
      expect(error?.code, "a close was attributed to somebody who did not submit it").toBe("42501");
    });

    it("cannot be edited once submitted, by anyone", async () => {
      // The property the whole control depends on. There is no update policy, so this changes
      // nothing rather than failing - which is why the assertion reads the row back.
      await f.personas.owner.db
        .from("daily_closes")
        .update({ declared_cash: 9999 })
        .eq("branch_id", f.branchA);
      const { data } = await f.personas.owner.db
        .from("daily_closes")
        .select("declared_cash")
        .eq("branch_id", f.branchA)
        .single();
      expect(
        Number((data as { declared_cash: string }).declared_cash),
        "a submitted count was edited",
      ).toBe(1600);
    });

    it("computes variance itself rather than trusting what was sent", async () => {
      const { data } = await f.personas.owner.db
        .from("daily_closes")
        .select("variance")
        .eq("branch_id", f.branchA)
        .single();
      expect(Number((data as { variance: string }).variance)).toBe(0);
    });
  });

  // ---------------------------------------------------------------- attendance

  describe("attendance", () => {
    it("lets a staff member clock in as themselves and see their own row", async () => {
      const { error } = await f.personas.staffA.db.from("attendance").insert({
        branch_id: f.branchA,
        staff_id: f.personas.staffA.userId,
      });
      expect(error).toBeNull();

      const { data } = await f.personas.staffB.db.from("attendance").select("id");
      expect(data ?? [], "staffB saw staffA's shift").toEqual([]);
    });

    it("refuses a second open shift for the same person", async () => {
      // The index that had to be replaced rather than dropped. A person holding two open shifts is
      // the duplicate-hours dispute this exists to prevent.
      const { error } = await f.personas.staffA.db.from("attendance").insert({
        branch_id: f.branchA,
        staff_id: f.personas.staffA.userId,
      });
      expect(error?.code, "one person held two open shifts").toBe("23505");
    });

    it("lets a manager see the branch and close a shift somebody left open", async () => {
      const { data: seen } = await f.personas.managerA.db.from("attendance").select("id,staff_id");
      expect((seen ?? []).length, "a manager could not see the branch's shifts").toBe(1);

      const { error } = await f.personas.managerA.db
        .from("attendance")
        .update({ clock_out: new Date().toISOString(), auto_closed: true, note: "left open" })
        .eq("staff_id", f.personas.staffA.userId);
      expect(error, "a manager could not fix a forgotten clock-out").toBeNull();
    });
  });

  // ------------------------------------------------------------ laundry orders

  describe("a laundry order", () => {
    let orderId: string;

    it("can be taken in unpaid where the branch says pay on claim", async () => {
      const { data: seq } = await f.personas.staffA.db.rpc("next_ticket_seq", {
        p_branch: f.branchA,
        p_period: "",
      });
      const n = Number(seq);
      const { data, error } = await f.personas.staffA.db
        .from("laundry_orders")
        .insert({
          branch_id: f.branchA,
          payment_mode: "on_claim",
          ticket_seq: n,
          ticket_no: `A-${String(n).padStart(4, "0")}`,
          contact_phone: "+639171234567",
          status: "received",
        })
        .select("id")
        .single();
      expect(error, "an unpaid intake was refused where the branch allows it").toBeNull();
      orderId = (data as { id: string }).id;
    });

    it("moves forward through the statuses", async () => {
      for (const status of ["washing", "drying", "folding", "ready"] as const) {
        const { error } = await f.personas.staffA.db
          .from("laundry_orders")
          .update({ status })
          .eq("id", orderId);
        expect(error, `could not move an order to ${status}`).toBeNull();
      }
      const { data } = await f.personas.staffA.db
        .from("laundry_orders")
        .select("status,ready_at")
        .eq("id", orderId)
        .single();
      const row = data as { status: string; ready_at: string | null };
      expect(row.status).toBe("ready");
      expect(row.ready_at, "ready_at was not recorded when the order became ready").not.toBeNull();
    });

    it("will not move backwards", async () => {
      const { error } = await f.personas.staffA.db
        .from("laundry_orders")
        .update({ status: "washing" })
        .eq("id", orderId);
      expect(error?.message ?? "", "an order went back a stage").toMatch(/only moves forward/i);
    });

    it("cannot be handed over while it is still unpaid", async () => {
      const { error } = await f.personas.staffA.db
        .from("laundry_orders")
        .update({ status: "claimed" })
        .eq("id", orderId);
      expect(error?.message ?? "", "an unpaid order was released").toMatch(
        /claimed_orders_are_paid|violates check/i,
      );
    });

    it("cannot be cancelled by a staff member", async () => {
      const { error } = await f.personas.staffA.db
        .from("laundry_orders")
        .update({ status: "cancelled" })
        .eq("id", orderId);
      expect(error?.message ?? "", "staff cancelled an order").toMatch(/manager or owner/i);
    });

    it("is invisible from another branch", async () => {
      const { data } = await f.personas.outsider.db.from("laundry_orders").select("ticket_no");
      expect(data ?? [], "an outsider read the laundry board").toEqual([]);
    });
  });
});
