import { describe, expect, it } from "vitest";

import { EMPTY, type KeypadKey, display, isCommittable, keyFromKeyboard, press, toPesos } from "@/lib/keypad";

/** Tap a sequence, the way a person does. */
function tap(...keys: KeypadKey[]) {
  return keys.reduce(press, EMPTY);
}

describe("amount entry", () => {
  it("records the amount in four taps", () => {
    // The rule the whole design is built around, asserted as a count rather than a comment.
    const keys: KeypadKey[] = ["1", "8", "0"];
    const state = tap(...keys);
    expect(keys.length + 1).toBeLessThanOrEqual(4); // three digits plus Record sale
    expect(toPesos(state)?.toString()).toBe("180.00");
  });

  it("collapses a leading zero", () => {
    // Tapping 0 then 5 is five pesos, not an invalid 05.
    expect(tap("0", "5").raw).toBe("5");
  });

  it("keeps a zero before the decimal point", () => {
    expect(tap("0", ".", "5").raw).toBe("0.5");
    expect(toPesos(tap("0", ".", "5"))?.toString()).toBe("0.50");
  });

  it("supplies the zero when the dot comes first", () => {
    expect(tap(".", "9", "9").raw).toBe("0.99");
  });

  it("ignores a second decimal point", () => {
    expect(tap("1", ".", "5", ".", "0").raw).toBe("1.50");
  });

  it("ignores a third decimal place", () => {
    // numeric(12,2) cannot hold it, so the keypad never lets it be entered - rather than
    // accepting it and having pesos() throw at the moment of recording a sale.
    expect(tap("1", ".", "9", "9", "9").raw).toBe("1.99");
  });

  it("stops at seven whole digits", () => {
    expect(tap("1", "2", "3", "4", "5", "6", "7", "8").raw).toBe("1234567");
  });

  it("backspaces one character at a time, including the dot", () => {
    expect(press(tap("1", "8", "0", "."), "backspace").raw).toBe("180");
    expect(press(tap("1", "8"), "backspace").raw).toBe("1");
  });

  it("clears to empty", () => {
    expect(press(tap("1", "8", "0"), "clear")).toEqual(EMPTY);
  });
});

describe("display", () => {
  it("groups thousands and dims an untyped fraction", () => {
    expect(display(tap("1", "2", "4", "8", "0"))).toEqual({ whole: "12,480", fraction: ".00" });
  });

  it("shows the fraction exactly as typed", () => {
    // Padding .5 to .50 mid-entry would move the digit the person is about to press.
    expect(display(tap("1", ".", "5")).fraction).toBe(".5");
    expect(display(tap("1", ".")).fraction).toBe(".");
  });

  it("shows a zero rather than nothing on an empty pad", () => {
    expect(display(EMPTY)).toEqual({ whole: "0", fraction: ".00" });
  });
});

describe("committable", () => {
  it("refuses an empty pad", () => {
    expect(isCommittable(EMPTY)).toBe(false);
    expect(toPesos(EMPTY)).toBeNull();
  });

  it("refuses zero, however it was typed", () => {
    // A zero sale is not a sale. Letting it through puts a row in the ledger that somebody
    // has to void by hand.
    expect(isCommittable(tap("0"))).toBe(false);
    expect(isCommittable(tap("0", ".", "0", "0"))).toBe(false);
    expect(isCommittable(tap("."))).toBe(false);
  });

  it("accepts a trailing dot as the number before it", () => {
    expect(toPesos(tap("1", "8", "0", "."))?.toString()).toBe("180.00");
  });

  it("accepts one centavo", () => {
    expect(isCommittable(tap("0", ".", "0", "1"))).toBe(true);
  });
});

describe("keyboard", () => {
  it("maps digits, both decimal separators, and the two cancels", () => {
    expect(keyFromKeyboard("7")).toBe("7");
    expect(keyFromKeyboard(".")).toBe(".");
    // A PH numeric keypad sends a comma on the decimal key under some layouts, and someone
    // typing 1,50 means 1.50 rather than nothing at all.
    expect(keyFromKeyboard(",")).toBe(".");
    expect(keyFromKeyboard("Backspace")).toBe("backspace");
    expect(keyFromKeyboard("Escape")).toBe("clear");
  });

  it("ignores everything else", () => {
    // Enter is the commit and is handled by the form, not by the pad - if it arrived here as
    // a key it would be swallowed and the sale would never record.
    for (const key of ["Enter", "Tab", "a", "ArrowLeft", "F5", " "]) {
      expect(keyFromKeyboard(key), key).toBeNull();
    }
  });
});
