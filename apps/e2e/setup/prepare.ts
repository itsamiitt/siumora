import { e2eBackend } from "./backend.ts";

/** Fresh data for whichever backend this run drives (plan 16 Phase J). */
if (e2eBackend() === "medusa") {
  await import("./prepare-medusa.ts");
} else {
  await import("./prepare-db.ts");
}
