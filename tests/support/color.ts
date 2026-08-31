/**
 * Just enough colour maths to hold a palette to a number instead of an opinion.
 *
 * Used by `tests/design-tokens.test.ts` as a gate and by `scripts/palette-check.mjs` to print
 * the table. Both, so the numbers in `docs/01-design.md` come from the same code that fails
 * the build - a palette justified by a screenshot is a palette that drifts.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** OKLCH -> OKLab -> linear sRGB -> sRGB. Values are 0-1 and may be clipped if out of gamut. */
export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  const lr = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const lg = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const lb = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;

  const gamma = (v: number) =>
    clamp01(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);

  return { r: gamma(lr), g: gamma(lg), b: gamma(lb) };
}

/** True when the colour needed clipping, i.e. it is not actually reachable in sRGB. */
export function isOutOfGamut({ l, c, h }: Oklch): boolean {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return linear.some((v) => v < -0.0005 || v > 1.0005);
}

export function toHex(rgb: Rgb): string {
  const byte = (v: number) =>
    Math.round(clamp01(v) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio. 3:1 is the floor for a graphical object such as a bar fill. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Viénot, Brettel and Mollon (1999) dichromacy simulation, in linear sRGB.
 *
 * An approximation, and the right kind: it answers "would these two series still look
 * different to each other", which is the only question a categorical palette has to survive.
 * Tritanopia is included because it is the one that punishes a cyan-and-blue pair, and cyan
 * is doing real work here.
 */
export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";

const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];

const LMS_TO_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
];

const COLLAPSE: Record<Deficiency, number[][]> = {
  protanopia: [
    [0, 2.02344, -2.52581],
    [0, 1, 0],
    [0, 0, 1],
  ],
  deuteranopia: [
    [1, 0, 0],
    [0.494207, 0, 1.24827],
    [0, 0, 1],
  ],
  tritanopia: [
    [1, 0, 0],
    [0, 1, 0],
    [-0.395913, 0.801109, 0],
  ],
};

function apply(matrix: number[][], v: number[]): number[] {
  return matrix.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

export function simulate(rgb: Rgb, deficiency: Deficiency): Rgb {
  const linear = [toLinear(rgb.r), toLinear(rgb.g), toLinear(rgb.b)];
  const lms = apply(RGB_TO_LMS, linear);
  const collapsed = apply(COLLAPSE[deficiency], lms);
  const back = apply(LMS_TO_RGB, collapsed);
  const gamma = (v: number) =>
    clamp01(v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055);
  return { r: gamma(back[0]), g: gamma(back[1]), b: gamma(back[2]) };
}

/** OKLab distance. Perceptually even, unlike a difference of hue numbers. */
export function deltaOk(a: Rgb, b: Rgb): number {
  const lab = ({ r, g, b: bb }: Rgb) => {
    const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(bb)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Pull `--name: oklch(l c h)` declarations out of a stylesheet, comments already stripped. */
export function readOklch(css: string, name: string): Oklch | null {
  const match = new RegExp(`${name}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`).exec(css);
  if (match === null) return null;
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) };
}

/** sRGB -> OKLCH, so a known-good hex palette can be checked and then written as tokens. */
export function hexToOklch(hex: string): Oklch {
  const n = hex.replace("#", "");
  const rgb = {
    r: parseInt(n.slice(0, 2), 16) / 255,
    g: parseInt(n.slice(2, 4), 16) / 255,
    b: parseInt(n.slice(4, 6), 16) / 255,
  };
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [lin(rgb.r), lin(rgb.g), lin(rgb.b)];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, bb), h: h < 0 ? h + 360 : h };
}
