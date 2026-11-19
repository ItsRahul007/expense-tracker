/**
 * @jest-environment node
 */
import { createTestDb } from "@/test-utils/sqlite";
import { getState, setState } from "@/sync/state";

import { transaction } from "@/db/schema/schema";
import { newTransactionStamp } from "@/sync/tracking";

import {
  endSession,
  finishBootstrap,
  readSession,
  signOutAndClear,
  startSession,
} from "../session";

const RAHUL = { id: "g-1", email: "rahul@example.com", name: "Rahul", photo: null };
const OTHER = { id: "g-2", email: "other@example.com", name: null, photo: null };

describe("session", () => {
  it("starts signed out on a fresh install", () => {
    const { db } = createTestDb();
    expect(readSession(db)).toEqual({ status: "signedOut", user: null });
  });

  it("first sign-in restores before the app opens, then stays ready", () => {
    const { db } = createTestDb();
    expect(startSession(db, RAHUL, 1)).toEqual({ ok: true });
    expect(readSession(db).status).toBe("restoring");

    finishBootstrap(db, { restorePending: false });
    expect(readSession(db)).toEqual({ status: "ready", user: RAHUL });
  });

  it("is read from SQLite alone — survives a restart with no network or Google SDK", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    finishBootstrap(db, { restorePending: false });
    // A "restart" is just reading the same database again.
    expect(readSession(db).status).toBe("ready");
  });

  it("'continue offline' opens the app and leaves the restore pending", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    finishBootstrap(db, { restorePending: true });
    expect(readSession(db).status).toBe("ready");
    expect(getState(db, "restore_pending")).toBe(true);
  });

  it("sign-out keeps the owner and sheet; signing back in opens straight away", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    setState(db, "spreadsheet_id", "sheet-1");
    finishBootstrap(db, { restorePending: false });

    endSession(db);
    expect(readSession(db).status).toBe("signedOut");
    expect(getState(db, "owner_user_id")).toBe("g-1");

    expect(startSession(db, RAHUL, 2)).toEqual({ ok: true });
    expect(readSession(db).status).toBe("ready");
    expect(getState(db, "spreadsheet_id")).toBe("sheet-1");
  });

  it("refuses a different account while this phone holds someone's data", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    finishBootstrap(db, { restorePending: false });
    endSession(db);

    expect(startSession(db, OTHER, 2)).toEqual({
      ok: false,
      reason: "owner_mismatch",
      ownerEmail: "rahul@example.com",
    });
    expect(readSession(db).status).toBe("signedOut");
  });

  it("adopting the data moves it to the new account and merges with its sheet", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    setState(db, "spreadsheet_id", "rahul-sheet");
    finishBootstrap(db, { restorePending: false });
    endSession(db);

    expect(startSession(db, OTHER, 2, { adoptExistingData: true })).toEqual({ ok: true });
    expect(getState(db, "owner_user_id")).toBe("g-2");
    expect(getState(db, "spreadsheet_id")).toBeNull();
    expect(readSession(db).status).toBe("restoring");
  });
});

describe("signOutAndClear", () => {
  it("removes the phone's data and every account link, keeping device preferences", () => {
    const { db } = createTestDb();
    startSession(db, RAHUL, 1);
    setState(db, "spreadsheet_id", "sheet-1");
    setState(db, "auto_sync", false);
    finishBootstrap(db, { restorePending: false });
    db.insert(transaction)
      .values({ id: "t-1", amountMinor: 1, categoryId: "c-food", occurredAt: 1, note: null, ...newTransactionStamp(db) })
      .run();
    const deviceId = getState(db, "device_id");

    signOutAndClear(db);

    expect(readSession(db).status).toBe("signedOut");
    expect(db.select().from(transaction).all()).toEqual([]);
    expect(getState(db, "owner_user_id")).toBeNull();
    expect(getState(db, "spreadsheet_id")).toBeNull();
    expect(getState(db, "device_id")).toBe(deviceId);
    expect(getState(db, "auto_sync")).toBe(false);

    // Any account can sign in next, with a clean restore.
    expect(startSession(db, OTHER, 2)).toEqual({ ok: true });
    expect(readSession(db).status).toBe("restoring");
  });
});
