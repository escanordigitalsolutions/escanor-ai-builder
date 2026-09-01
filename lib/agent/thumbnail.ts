/**
 * A real picture of the design, taken from the design itself.
 *
 * The dashboard and the Wizard used to preview a design by loading its whole
 * HTML into a scaled-down iframe — fonts, scripts and all, once per card. This
 * renders the finished homepage ONCE, server-side, headless, and keeps a JPEG;
 * every preview after that is one <img> tag.
 *
 * It is a screenshot on purpose. The obvious-sounding alternative — asking an
 * image model to draw "a preview of this design" — produces a picture of a
 * design that does not exist: plausible typography, invented layout, wrong
 * colours. The design is real HTML; the only truthful image of it is a render
 * of it.
 *
 * The imports are resolved at run time from names held in variables, which is
 * deliberate: the two packages are heavy, Vercel installs them at build, and
 * the local environment cannot (its registry proxy refuses new packages). A
 * variable specifier keeps the type-checker from requiring them to exist here,
 * and next.config's outputFileTracingIncludes ships them to the functions that
 * call this, since a traced import this dynamic cannot be followed.
 */

const CHROMIUM_PKG = "@sparticuz/chromium";
const PUPPETEER_PKG = "puppeteer-core";

/** What a stored thumbnail looks like inside ai_designs.assets. */
export type Thumb = {
  /** base64 JPEG, no data: prefix — the serving route adds headers, not markup. */
  jpeg: string;
  width: number;
  height: number;
  /** Cache-buster: bumped on every re-render, so an edited design's image updates. */
  version: number;
};

/**
 * Render a homepage to a JPEG. Returns null on ANY failure — a design without
 * a picture falls back to the old iframe preview, which is slower, not broken.
 */
export async function renderThumbnail(html: string): Promise<Thumb | null> {
  let browser: { newPage(): Promise<unknown>; close(): Promise<void> } | null = null;

  try {
    const chromium = (await import(CHROMIUM_PKG)).default;
    const puppeteer = (await import(PUPPETEER_PKG)).default;

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (await browser!.newPage()) as any;

    // networkidle0 waits for the Google Fonts; the cap keeps a hung request
    // from spending the design job's budget on a picture.
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25_000 }).catch(() => {
      // A font that never loads still leaves a paintable page.
    });

    // The reveal pattern hides sections until an IntersectionObserver fires;
    // above-the-fold ones have fired by now, but force the rest so the shot
    // shows the page, not a page of blank slots.
    await page.evaluate(() => {
      document
        .querySelectorAll("[data-reveal]")
        .forEach((el: Element) => el.classList.add("in-view"));
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const buffer: Buffer = await page.screenshot({
      type: "jpeg",
      quality: 72,
      clip: { x: 0, y: 0, width: 1280, height: 800 },
    });

    return {
      jpeg: buffer.toString("base64"),
      width: 1280,
      height: 800,
      version: Date.now(),
    };
  } catch (error) {
    console.error("thumbnail render failed (design keeps its iframe preview):", error);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
