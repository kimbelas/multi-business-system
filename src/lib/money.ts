/**
 * Money, as an exact decimal.
 *
 * Section 4 of the spec: `numeric(12,2)`, never a float. The database enforces that and the
 * application has to agree with it, because a number that survives the round trip but drifts
 * in between produces a daily close that is a few centavos out - and a variance nobody can
 * explain is worse than no variance figure at all.
 *
 * Stored as an integer number of centavos. A safe integer covers far more than
 * `numeric(12,2)` can hold, so the representation cannot overflow before the column does.
 */
export class Pesos {
  private constructor(private readonly centavos: number) {}

  static from(value: string | number): Pesos {
    const text = typeof value === "number" ? value.toString() : value.trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(text)) {
      // A third decimal place is not a rounding question, it is a value this column cannot
      // hold. Refusing here is what stops it being silently rounded on the way to Postgres.
      throw new Error(`Not an exact peso amount: ${JSON.stringify(value)}`);
    }
    const [whole, fraction = ""] = text.split(".");
    const sign = whole!.startsWith("-") ? -1 : 1;
    const centavos = Math.abs(Number(whole)) * 100 + Number(fraction.padEnd(2, "0") || "0");
    return new Pesos(sign * centavos);
  }

  plus(other: Pesos): Pesos {
    return new Pesos(this.centavos + other.centavos);
  }

  minus(other: Pesos): Pesos {
    return new Pesos(this.centavos - other.centavos);
  }

  toString(): string {
    const sign = this.centavos < 0 ? "-" : "";
    const abs = Math.abs(this.centavos);
    return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  }
}

export const pesos = Pesos.from;
