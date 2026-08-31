import { type Pesos, pesos } from "@/lib/money";

/**
 * Amount entry, as a pure reducer.
 *
 * The four-tap rule lives here rather than in a component. Every rule about what a keypress
 * does - a third decimal is ignored, a second dot is ignored, a leading zero collapses - is a
 * rule somebody will otherwise discover at the counter, and a component test that renders a
 * keypad to find out is a slow way to ask a fast question.
 *
 * The state is the raw keyed string and nothing else. Holding a parsed number instead would
 * lose the difference between `180` and `180.` - which is not a value difference but is
 * absolutely a display difference, because one of them has the user mid-keystroke.
 */

/** Enough for 9,999,999.99, which is far more than a branch takes in a day. */
const MAX_WHOLE_DIGITS = 7;
const MAX_FRACTION_DIGITS = 2;

export interface KeypadState {
  /** "" | "0" | "180" | "180." | "180.5" | "180.50" */
  readonly raw: string;
}

export const EMPTY: KeypadState = { raw: "" };

export type KeypadKey =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "."
  | "backspace"
  | "clear";

/** Every key a physical keyboard can send, mapped to a keypad key. Desktop rule 5. */
export function keyFromKeyboard(key: string): KeypadKey | null {
  if (/^[0-9]$/.test(key)) return key as KeypadKey;
  if (key === "." || key === ",") return ".";
  if (key === "Backspace" || key === "Delete") return "backspace";
  if (key === "Escape") return "clear";
  return null;
}

export function press(state: KeypadState, key: KeypadKey): KeypadState {
  if (key === "clear") return EMPTY;
  if (key === "backspace") return { raw: state.raw.slice(0, -1) };

  const [whole = "", fraction] = state.raw.split(".");
  const hasDot = fraction !== undefined;

  if (key === ".") {
    if (hasDot) return state; // A second dot is a slip, not an instruction.
    return { raw: `${whole === "" ? "0" : whole}.` };
  }

  if (hasDot) {
    if (fraction.length >= MAX_FRACTION_DIGITS) return state;
    return { raw: `${whole}.${fraction}${key}` };
  }

  // A leading zero collapses, so tapping 0 then 5 is 5 rather than 05 - except after a dot,
  // where 0.05 needs both.
  if (whole === "0") return { raw: key };
  if (whole.length >= MAX_WHOLE_DIGITS) return state;
  return { raw: whole + key };
}

/**
 * What to put on screen, split so the fraction can be dimmed.
 *
 * The fraction is shown exactly as typed and only defaults to `.00` when no dot has been
 * pressed. Padding `.5` to `.50` while somebody is still typing would move a digit they are
 * about to enter.
 */
export function display(state: KeypadState): { whole: string; fraction: string } {
  const [whole = "", fraction] = state.raw.split(".");
  const grouped = (whole === "" ? "0" : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return { whole: grouped, fraction: fraction === undefined ? ".00" : `.${fraction}` };
}

/** The exact amount, or null when nothing recordable has been entered yet. */
export function toPesos(state: KeypadState): Pesos | null {
  const text = state.raw.endsWith(".") ? state.raw.slice(0, -1) : state.raw;
  if (text === "") return null;
  const value = pesos(text);
  return value.toString() === "0.00" ? null : value;
}

/**
 * Whether Record sale should do anything. A zero sale is not a sale, and letting it through
 * puts a row in the ledger that has to be voided by hand later.
 */
export function isCommittable(state: KeypadState): boolean {
  return toPesos(state) !== null;
}
