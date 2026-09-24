# Rato implementation plan

This plan follows the canonical model and settlement rules in [design.md](design.md). Each phase ends with a usable, verifiable result. The app needs no server or account.

## Phase 1 — Foundation and persistent store

1. Initialize Vite with React 18 and strict TypeScript. Add React Router v7, Tailwind CSS, Lucide React, Zustand, and `localforage`; select a chart library when charts are implemented.
2. Put the exact contract from `design.md` into `src/types/index.ts`. Add runtime validators for imported dates, safe integer cents, rates, IDs, recurrence, and scenario invariants.
3. Implement `src/store/useAppStore.ts` with Zustand `persist`, `createJSONStorage`, and a `localforage` adapter. Persist only `AppData`; set a storage version and migration hook. Wait for hydration before enabling edits.
4. Seed a baseline with two generic, empty partner profiles. Implement scenario duplication, selection, rename, deletion, profile management, ledger edits, calculation mode, and assumptions. Protect the baseline and selected participant references.
5. Verify reload persistence, baseline/sandbox isolation, and active-scenario fallback after sandbox deletion.

## Phase 2 — Recurrence and calculation utilities

1. Implement `src/utils/recurrence.ts` for one-time, monthly, quarterly, and yearly items, inclusive end dates, month-end clamping, and monthly totals.
2. Implement pure functions in `src/utils/calculations.ts` for personal and joint totals, net joint cost, and all three settlement modes. Use signed transfers and formulas from `design.md`. Reconcile the existing `docs/calculation_engine.md` draft.
3. Add focused tests for zero income, unequal income, personal expenses in equal remainder, negative net joint cost, odd-cent rounding, boundary dates, leap days, and scenario isolation.
4. Implement `src/utils/forecast.ts` for a configurable monthly series using income growth and category-specific or global expense inflation. Keep calculations independent of React and Zustand.

## Phase 3 — Routing and app shell

1. Configure React Router v7 with `/` for the dashboard, `/editor` for the ledger, `/settings` for controls, and a fallback route.
2. Build a shared layout with navigation, active scenario selector, a selected month control backed by `?month=YYYY-MM`, and a clear baseline/sandbox indicator.
3. Add scenario actions: duplicate and name a sandbox, switch scenarios, rename one, and delete a sandbox. Clearly show which scenario edits affect.
4. Verify direct route loads, browser back/forward, scenario switching, and hydration before interaction.

## Phase 4 — Data grid editors

1. Build reusable income and expense grid editors for each selected profile and the joint ledger. Derive profile tabs and labels from `participantIds` and `profiles`; never embed person names in components.
2. Support add, edit, duplicate, and delete for financial items. Fields: name, amount, category, frequency, start date, and optional end date. Convert displayed amounts to integer cents at the form boundary.
3. Show recurrence validation beside rows, including invalid dates and end dates before start dates. Confirm destructive deletes where appropriate.
4. Add profile naming and partner selection controls while preserving the two-distinct-participant invariant. Verify sandbox edits do not alter baseline rows.

## Phase 5 — Dashboard and forecasting visuals

1. Compute the selected month's settlement from the active scenario. Show joint income, joint expenses, net joint cost, each partner's signed transfer, and each partner's discretionary amount.
2. Show breakdowns by category and ledger ownership so users can trace transfers to source items.
3. Add a monthly forecast chart and table for a chosen horizon, showing income, expenses, transfers, and discretionary cash flow for both partners. Label projections and display assumptions. Defer wealth charts until opening balances are modeled.
4. Verify that changing month, mode, or scenario updates all figures consistently, including negative transfers and deficits.

## Phase 6 — Settings, portability, and release checks

1. Provide controls for the scenario's calculation mode, annual rates, category overrides, and app currency.
2. Export versioned JSON containing only `AppData`. Validate a complete import before applying it; reject invalid or unsupported versions without changing current data. Preview and confirm replacement.
3. Test import/export round trips, IndexedDB persistence, empty ledgers, corrupt storage recovery, keyboard and screen-reader access, and responsive layouts.
4. Run type checking, tests, and a production build. Document local device storage and JSON export as the backup mechanism.
