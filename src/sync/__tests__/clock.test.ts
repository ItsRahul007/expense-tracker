import { nextStamp, resetClockForTests } from "../clock";

beforeEach(() => resetClockForTests());

describe("nextStamp", () => {
  it("follows the wall clock when it moves forward", () => {
    expect(nextStamp(1000)).toBe(1000);
    expect(nextStamp(2000)).toBe(2000);
  });

  it("never repeats a value within the same millisecond", () => {
    const a = nextStamp(5000);
    const b = nextStamp(5000);
    const c = nextStamp(5000);
    expect([a, b, c]).toEqual([5000, 5001, 5002]);
  });

  it("never goes backwards when the clock does", () => {
    nextStamp(10_000);
    // The user (or NTP) sets the clock back a minute.
    expect(nextStamp(-50_000 + 10_000)).toBe(10_001);
    expect(nextStamp(10_000)).toBe(10_002);
  });

  it("defaults to Date.now()", () => {
    const before = Date.now();
    const stamp = nextStamp();
    expect(stamp).toBeGreaterThanOrEqual(before);
  });
});
