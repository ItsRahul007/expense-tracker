/**
 * Thin clients for the two Google APIs sync uses, over plain `fetch`.
 * Design §10.7 / §14 for the error behaviour.
 *
 * The access token comes from a `TokenProvider` (src/auth/google.ts in the
 * app, a fake in tests), so nothing here knows about the sign-in library.
 */
import type { Grid, TabName } from "./sheet-format";

export type TokenProvider = {
  getAccessToken(): Promise<string>;
  /** Drop a token Google rejected, so the next `getAccessToken` fetches a fresh one. */
  invalidate(token: string): Promise<void>;
};

// --- errors ---------------------------------------------------------------------

export class SyncHttpError extends Error {
  constructor(
    readonly kind: "offline" | "auth" | "scope" | "not_found" | "rate_limited" | "server" | "bad_request",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

export const isSyncHttpError = (e: unknown, kind?: SyncHttpError["kind"]): e is SyncHttpError =>
  e instanceof SyncHttpError && (kind === undefined || e.kind === kind);

// --- transport ------------------------------------------------------------------

export type HttpOptions = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Backoff attempts for 429 / 5xx / rate-limit 403. */
  maxRetries?: number;
  random?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type GoogleErrorBody = { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };

async function readError(response: Response): Promise<{ message: string; reason: string }> {
  try {
    const body = (await response.json()) as GoogleErrorBody;
    return {
      message: body.error?.message ?? response.statusText,
      reason: body.error?.errors?.[0]?.reason ?? body.error?.status ?? "",
    };
  } catch {
    return { message: response.statusText, reason: "" };
  }
}

export function createHttp(tokens: TokenProvider, options: HttpOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRetries ?? 5;
  const random = options.random ?? Math.random;

  return async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await tokens.getAccessToken();
      let response: Response;
      try {
        response = await doFetch(url, {
          ...init,
          headers: {
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (error) {
        throw new SyncHttpError("offline", error instanceof Error ? error.message : "Network request failed");
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const { message, reason } = await readError(response);
      const status = response.status;

      if (status === 401) {
        // Expired or revoked token: refresh once, then give up (design §7.5 —
        // this pauses sync, it never signs the user out).
        await tokens.invalidate(token);
        if (!refreshed) {
          refreshed = true;
          continue;
        }
        throw new SyncHttpError("auth", message, status);
      }

      const rateLimited =
        status === 429 ||
        (status === 403 && /rateLimitExceeded|userRateLimitExceeded|RESOURCE_EXHAUSTED/.test(reason));
      if (rateLimited || status >= 500) {
        if (attempt < maxRetries) {
          // 1, 2, 4, 8, 16 s, with ±50% jitter so two devices don't retry in step.
          const base = 1000 * 2 ** attempt;
          await sleep(base * (0.5 + random()));
          continue;
        }
        throw new SyncHttpError(rateLimited ? "rate_limited" : "server", message, status);
      }

      if (status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/.test(reason)) {
        throw new SyncHttpError("scope", message, status);
      }
      if (status === 404) throw new SyncHttpError("not_found", message, status);
      throw new SyncHttpError("bad_request", message, status);
    }
  };
}

export type Http = ReturnType<typeof createHttp>;

// --- Drive ----------------------------------------------------------------------

const DRIVE = "https://www.googleapis.com/drive/v3";
export const APP_PROPERTY = { key: "app", value: "expense-tracker" } as const;
export const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

export type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
  version?: string;
  trashed?: boolean;
};

export function createDriveClient(http: Http) {
  return {
    /** The app's spreadsheets in this account, newest first. Works under `drive.file`. */
    async findAppSpreadsheets(): Promise<DriveFile[]> {
      const q = [
        `appProperties has { key='${APP_PROPERTY.key}' and value='${APP_PROPERTY.value}' }`,
        `mimeType='${SPREADSHEET_MIME}'`,
        "trashed=false",
      ].join(" and ");
      const params = new URLSearchParams({
        q,
        orderBy: "modifiedTime desc",
        fields: "files(id,name,modifiedTime,version)",
        pageSize: "10",
        spaces: "drive",
      });
      const result = await http<{ files?: DriveFile[] }>(`${DRIVE}/files?${params}`);
      return result.files ?? [];
    },

    /** Cheap change check for the fast path (design §7.4). */
    async getFile(id: string): Promise<DriveFile> {
      const params = new URLSearchParams({ fields: "id,name,version,modifiedTime,trashed" });
      return http<DriveFile>(`${DRIVE}/files/${encodeURIComponent(id)}?${params}`);
    },

    /** Creates an empty spreadsheet tagged as this app's. */
    async createSpreadsheet(name: string): Promise<DriveFile> {
      const params = new URLSearchParams({ fields: "id,name,version,modifiedTime" });
      return http<DriveFile>(`${DRIVE}/files?${params}`, {
        method: "POST",
        body: JSON.stringify({
          name,
          mimeType: SPREADSHEET_MIME,
          appProperties: { [APP_PROPERTY.key]: APP_PROPERTY.value },
        }),
      });
    },
  };
}

export type DriveClient = ReturnType<typeof createDriveClient>;

// --- Sheets ---------------------------------------------------------------------

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

export const a1 = (tab: string, cell = "A1") => `'${tab.replace(/'/g, "''")}'!${cell}`;

export type SheetProperties = {
  sheetId: number;
  title: string;
  hidden?: boolean;
  gridProperties?: { rowCount?: number; columnCount?: number };
};

export function createSheetsClient(http: Http) {
  async function tabs(spreadsheetId: string): Promise<SheetProperties[]> {
    const params = new URLSearchParams({
      fields: "sheets.properties(sheetId,title,hidden,gridProperties(rowCount,columnCount))",
    });
    const result = await http<{ sheets?: { properties: SheetProperties }[] }>(
      `${SHEETS}/${encodeURIComponent(spreadsheetId)}?${params}`,
    );
    return (result.sheets ?? []).map((s) => s.properties);
  }

  async function batchGetRaw(spreadsheetId: string, titles: string[]): Promise<Partial<Record<TabName, Grid>>> {
    const params = new URLSearchParams({
      valueRenderOption: "UNFORMATTED_VALUE",
      majorDimension: "ROWS",
    });
    for (const title of titles) params.append("ranges", a1(title, "A1:Z"));
    const result = await http<{ valueRanges?: { values?: Grid }[] }>(
      `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`,
    );
    const out: Partial<Record<TabName, Grid>> = {};
    titles.forEach((title, i) => {
      out[title as TabName] = result.valueRanges?.[i]?.values ?? [];
    });
    return out;
  }

  return {
    tabs,

    /**
     * Every listed tab's values in one request. A tab the user deleted makes
     * the whole request fail, so on that error the existing tabs are looked up
     * and only those are read. `missing` lists the tabs that aren't there.
     */
    async readTabs(
      spreadsheetId: string,
      titles: TabName[],
    ): Promise<{ values: Partial<Record<TabName, Grid>>; missing: TabName[] }> {
      try {
        return { values: await batchGetRaw(spreadsheetId, titles), missing: [] };
      } catch (error) {
        if (!isSyncHttpError(error, "bad_request")) throw error;
        const existing = new Set((await tabs(spreadsheetId)).map((t) => t.title));
        const present = titles.filter((t) => existing.has(t));
        const missing = titles.filter((t) => !existing.has(t));
        const values = present.length ? await batchGetRaw(spreadsheetId, present) : {};
        return { values, missing };
      }
    },

    /** Writes several ranges in one request; `RAW` so text is never evaluated. */
    async writeRanges(spreadsheetId: string, data: { range: string; values: Grid }[]): Promise<void> {
      if (data.length === 0) return;
      await http(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data }),
      });
    },

    /** Structural changes: add tabs, formats, protection. */
    async batchUpdate(spreadsheetId: string, requests: object[]): Promise<void> {
      if (requests.length === 0) return;
      await http(`${SHEETS}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests }),
      });
    },
  };
}

export type SheetsClient = ReturnType<typeof createSheetsClient>;

export const spreadsheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;
