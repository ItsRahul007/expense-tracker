import {
  a1,
  createDriveClient,
  createHttp,
  createSheetsClient,
  isSyncHttpError,
  type TokenProvider,
} from "../google-api";
import { TAB } from "../sheet-format";
import { structureRequests, TAB_ORDER } from "../sheet-setup";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function tokens(): TokenProvider & { invalidated: string[]; issued: number } {
  const state = {
    invalidated: [] as string[],
    issued: 0,
    async getAccessToken() {
      state.issued += 1;
      return `token-${state.issued}`;
    },
    async invalidate(token: string) {
      state.invalidated.push(token);
    },
  };
  return state;
}

const noSleep = { sleep: async () => {}, random: () => 0.5 };

describe("createHttp", () => {
  it("sends the bearer token and parses JSON", async () => {
    const fetch = jest.fn(async () => json(200, { ok: 1 }));
    const http = createHttp(tokens(), { fetch: fetch as never, ...noSleep });
    await expect(http("https://x")).resolves.toEqual({ ok: 1 });
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
      headers: { Authorization: "Bearer token-1" },
    });
  });

  it("on 401 drops the token and retries once with a fresh one", async () => {
    const t = tokens();
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(401, { error: { message: "expired" } }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    const http = createHttp(t, { fetch, ...noSleep });
    await expect(http("https://x")).resolves.toEqual({ ok: 1 });
    expect(t.invalidated).toEqual(["token-1"]);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer token-2");
  });

  it("a second 401 is an auth error (sync pauses; nobody is signed out)", async () => {
    const fetch = jest.fn(async () => json(401, { error: { message: "revoked" } }));
    const http = createHttp(tokens(), { fetch: fetch as never, ...noSleep });
    const error = await http("https://x").catch((e) => e);
    expect(isSyncHttpError(error, "auth")).toBe(true);
  });

  it("backs off on 429 and 5xx, then succeeds", async () => {
    const sleep = jest.fn(async () => {});
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    const http = createHttp(tokens(), { fetch, sleep, random: () => 0.5 });
    await expect(http("https://x")).resolves.toEqual({ ok: 1 });
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([1000, 2000]);
  });

  it("treats a rate-limit 403 like a 429", async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }))
      .mockResolvedValueOnce(json(200, {}));
    const http = createHttp(tokens(), { fetch, ...noSleep });
    await expect(http("https://x")).resolves.toEqual({});
  });

  it("gives up after maxRetries", async () => {
    const fetch = jest.fn(async () => json(500, {}));
    const http = createHttp(tokens(), { fetch: fetch as never, ...noSleep, maxRetries: 2 });
    const error = await http("https://x").catch((e) => e);
    expect(isSyncHttpError(error, "server")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("classifies scope, not found and offline", async () => {
    const scope = createHttp(tokens(), {
      fetch: (async () => json(403, { error: { errors: [{ reason: "insufficientPermissions" }] } })) as never,
      ...noSleep,
    });
    expect(isSyncHttpError(await scope("u").catch((e) => e), "scope")).toBe(true);

    const missing = createHttp(tokens(), { fetch: (async () => json(404, {})) as never, ...noSleep });
    expect(isSyncHttpError(await missing("u").catch((e) => e), "not_found")).toBe(true);

    const offline = createHttp(tokens(), {
      fetch: (async () => {
        throw new TypeError("Network request failed");
      }) as never,
      ...noSleep,
    });
    expect(isSyncHttpError(await offline("u").catch((e) => e), "offline")).toBe(true);
  });
});

describe("Drive client", () => {
  it("finds the app's spreadsheets by appProperties", async () => {
    const fetch = jest.fn(async () => json(200, { files: [{ id: "s1", name: "Expense Tracker" }] }));
    const drive = createDriveClient(createHttp(tokens(), { fetch: fetch as never, ...noSleep }));
    await expect(drive.findAppSpreadsheets()).resolves.toEqual([{ id: "s1", name: "Expense Tracker" }]);
    const url = new URL((fetch.mock.calls[0] as unknown as [string])[0]).searchParams.get("q");
    expect(url).toContain("appProperties has { key='app' and value='expense-tracker' }");
    expect(url).toContain("trashed=false");
  });

  it("creates the spreadsheet with the app tag", async () => {
    const fetch = jest.fn(async () => json(200, { id: "s1", name: "Expense Tracker" }));
    const drive = createDriveClient(createHttp(tokens(), { fetch: fetch as never, ...noSleep }));
    await drive.createSpreadsheet("Expense Tracker");
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      name: "Expense Tracker",
      mimeType: "application/vnd.google-apps.spreadsheet",
      appProperties: { app: "expense-tracker" },
    });
  });
});

describe("Sheets client", () => {
  it("reads every tab in one request", async () => {
    const fetch = jest.fn(async () =>
      json(200, { valueRanges: [{ values: [["a"]] }, {}] }),
    );
    const sheets = createSheetsClient(createHttp(tokens(), { fetch: fetch as never, ...noSleep }));
    const result = await sheets.readTabs("s1", [TAB.expenses, TAB.meta]);
    expect(result).toEqual({ values: { [TAB.expenses]: [["a"]], [TAB.meta]: [] }, missing: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = decodeURIComponent((fetch.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(url).toContain("ranges='Expenses'!A1:Z");
  });

  it("falls back to the tabs that exist when one was deleted", async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce(json(400, { error: { message: "Unable to parse range: '_meta'!A1:Z" } }))
      .mockResolvedValueOnce(json(200, { sheets: [{ properties: { sheetId: 0, title: "Expenses" } }] }))
      .mockResolvedValueOnce(json(200, { valueRanges: [{ values: [["h"]] }] }));
    const sheets = createSheetsClient(createHttp(tokens(), { fetch, ...noSleep }));
    await expect(sheets.readTabs("s1", [TAB.expenses, TAB.meta])).resolves.toEqual({
      values: { [TAB.expenses]: [["h"]] },
      missing: [TAB.meta],
    });
  });

  it("writes with RAW so text is never evaluated", async () => {
    const fetch = jest.fn(async () => json(200, {}));
    const sheets = createSheetsClient(createHttp(tokens(), { fetch: fetch as never, ...noSleep }));
    await sheets.writeRanges("s1", [{ range: a1(TAB.expenses), values: [["=SUM(1)"]] }]);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.valueInputOption).toBe("RAW");
  });

  it("quotes tab names in A1 ranges", () => {
    expect(a1("It's", "A1:Z")).toBe("'It''s'!A1:Z");
  });
});

describe("structureRequests", () => {
  const titles = (requests: object[]) =>
    requests.flatMap((r) => {
      const add = (r as { addSheet?: { properties: { title: string } } }).addSheet;
      const rename = (r as { updateSheetProperties?: { properties: { title: string } } }).updateSheetProperties;
      return add ? [add.properties.title] : rename ? [rename.properties.title] : [];
    });

  it("turns a fresh spreadsheet into the full layout, reusing the default tab", () => {
    const requests = structureRequests([{ sheetId: 0, title: "Sheet1" }]);
    expect(titles(requests)).toEqual(TAB_ORDER);
    expect(requests[0]).toEqual({
      updateSheetProperties: { properties: { sheetId: 0, title: TAB.readme }, fields: "title" },
    });
    const hidden = requests
      .map((r) => (r as { addSheet?: { properties: { title: string; hidden: boolean } } }).addSheet?.properties)
      .filter((p) => p?.hidden)
      .map((p) => p!.title);
    expect(hidden).toEqual([TAB.tombstones, TAB.exceptions, TAB.meta]);
  });

  it("only adds what's missing, with fresh ids", () => {
    const existing = TAB_ORDER.filter((t) => t !== TAB.meta).map((title, i) => ({ sheetId: i * 7, title }));
    const requests = structureRequests(existing);
    expect(titles(requests)).toEqual([TAB.meta]);
    const id = (requests[0] as { addSheet: { properties: { sheetId: number } } }).addSheet.properties.sheetId;
    expect(existing.some((s) => s.sheetId === id)).toBe(false);
  });

  it("does nothing when the layout is complete", () => {
    expect(structureRequests(TAB_ORDER.map((title, i) => ({ sheetId: i, title })))).toEqual([]);
  });
});
