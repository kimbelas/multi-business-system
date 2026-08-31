/**
 * What is actually deployed at a URL.
 *
 *   node scripts/deployed-check.mjs https://bizdesk.<subdomain>.workers.dev
 *
 * Exists because two separate wrong answers came out of not having it. A browser tab reported
 * the create-next-app starter page long after the login screen had shipped, because it held a
 * response cached before the current `no-store` headers existed. And the ad-hoc curl written to
 * replace the browser grepped for `/_next/static/css/...`, which Turbopack does not use - it
 * puts stylesheets under `/_next/static/chunks/`. That probe ran fifty times, matched nothing
 * every time, and reported "still the old build" throughout. It could not have said anything
 * else.
 *
 * So: find the stylesheet the way the page actually links it, and test for tokens that exist in
 * the source. A marker has to be something the compiled CSS keeps whether or not a utility uses
 * it - a `:root` custom property does; a Tailwind class may be tree-shaken away.
 */

const url = (process.argv[2] ?? "").replace(/\/$/, "");
if (!url) {
  console.error("usage: node scripts/deployed-check.mjs <url>");
  process.exit(2);
}

/** Each marker is a `:root` declaration, and the commit that introduced it. */
const MARKERS = [
  ["--biz-laundry", "the accessible chart palette"],
  ["--commit:", "the Counter theme accent"],
  ["--key-h", "the control-height floors"],
  ["--chart-past", "the theme-aware chart dimming"],
];

async function text(path) {
  const response = await fetch(`${url}${path}`, { redirect: "follow" });
  return { response, body: await response.text() };
}

const root = await fetch(url, { redirect: "follow" });
console.log(`GET /            ${root.status}  ->  ${root.url}`);

const { body: html } = await text("/login");
const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "(none)";
console.log(`GET /login       title: ${title}`);

// Whatever the page links, however it spells it. Both `chunks/` and `css/` have been used by
// different Next versions, so this reads the href rather than assuming the shape.
const href = /href="(\/_next\/static\/[^"]*\.css)"/.exec(html)?.[1];
if (!href) {
  console.error("\nNo stylesheet link found in /login - cannot check the build markers.");
  console.error("That is a finding, not a pass: look at the HTML before trusting it.");
  process.exit(1);
}
console.log(`stylesheet       ${href}`);

const css = await (await fetch(`${url}${href}`)).text();
console.log(`                 ${css.length} bytes\n`);

let missing = 0;
for (const [marker, what] of MARKERS) {
  const present = css.includes(marker);
  if (!present) missing += 1;
  console.log(`  ${present ? "present" : "ABSENT "}  ${marker.padEnd(14)} ${what}`);
}

console.log(
  missing === 0
    ? "\nThe current build is deployed."
    : `\n${missing} of ${MARKERS.length} markers absent - this is an older build.` +
        "\nActions tab: CI first, then Deploy. A skipped Deploy means CI was not green.",
);
process.exit(missing === 0 ? 0 : 1);
