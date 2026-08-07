/**
 * The single import point for all data access. Components import from
 * `@/queries` and never from `mock.ts` or `live.ts` directly.
 *
 * ---------------------------------------------------------------------------
 * RAHUL — this is the swap point.
 *
 * Write `src/queries/live.ts` exporting the same names with the same
 * signatures (TypeScript will tell you the moment one drifts), then change the
 * line below to:
 *
 *     export * from "./live";
 *
 * No component changes. If you want to A/B the two while building, export from
 * `live` and re-export individual hooks from `mock` until each one is ready.
 * ---------------------------------------------------------------------------
 */

export * from "./live";
