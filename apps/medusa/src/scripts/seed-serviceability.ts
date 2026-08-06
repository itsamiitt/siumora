/**
 * Serviceability seed — the five canonical pincode rows into the
 * serviceability module's table.
 *
 * Run from apps/medusa:
 *
 *   npx medusa exec ./src/scripts/seed-serviceability.ts
 *
 * A separate exec script rather than a loader hook or an addition to
 * seed.ts, decided and written down:
 * - not a module loader hook, because loaders run on EVERY boot of every
 *   process (workers included) and a seed that writes rows belongs to an
 *   operator's explicit action, exactly like the main catalog seed;
 * - not inside scripts/seed.ts, because that file is owned by the catalog
 *   port and each concern seeds independently (this one is also runnable
 *   before the catalog exists — the serviceability table has no foreign
 *   keys, by module convention).
 *
 * The work itself lives in the module (seedServiceability in
 * src/modules/serviceability/lookup.ts): convergent upserts of the rows in
 * src/modules/serviceability/pincodes.ts (ported from packages/db/src/
 * seed.ts PINCODES), plus an IF-NOT-EXISTS stand-up of the table for the
 * window before the module is registered in medusa-config.ts (owned
 * elsewhere — see the module's REGISTER.md).
 */

import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

import {
  seedServiceability,
  type SqlClient,
} from "../modules/serviceability/lookup";

export default async function run({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const pg = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION,
  ) as unknown as SqlClient;

  const { pincodes } = await seedServiceability(pg);
  logger.info(`seed-serviceability: ${pincodes} pincodes converged`);
  logger.info(
    "seed-serviceability: GET /store/siumora/pincodes/:pincode now answers the serviceability card",
  );
}
