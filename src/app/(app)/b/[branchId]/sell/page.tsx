import { notFound } from "next/navigation";

import { requireCapability } from "@/lib/authz";

import { SaleForm } from "./sale-form";

/**
 * The counter — `/b/[branchId]/sell`.
 *
 * The first screen in this app where a peso is real rather than invented. `/preview` renders the
 * same component against made-up figures on purpose; this one renders it against a branch, and
 * every sale it takes is attributed to the person signed in.
 *
 * Params are typed by hand rather than with Next's generated `PageProps` — that type is written
 * into `.next/types` by a build, so a file using it compiles on a machine that has run `next dev`
 * and fails in a fresh checkout. `tests/generated-types.test.ts` carries the whole story.
 *
 * The guard here protects the render. It is not what protects the write: `recordSale` calls
 * `requireCapability` again as its first statement, because a server action is a POST endpoint that
 * a request can reach without going through this page at all.
 */
export default async function SellPage({ params }: { params: Promise<{ branchId: string }> }) {
  const { branchId } = await params;
  const scope = await requireCapability("recordSale", { branchId });

  const business = scope.businesses.find((candidate) =>
    candidate.branches.some((branch) => branch.id === branchId),
  );
  const branch = business?.branches.find((candidate) => candidate.id === branchId);

  // `requireCapability` has already refused a branch this person cannot reach, so a miss here means
  // the id is not a branch at all rather than one they may not have.
  if (!business || !branch) notFound();

  return <SaleForm branchId={branch.id} businessName={business.name} branchName={branch.name} />;
}
