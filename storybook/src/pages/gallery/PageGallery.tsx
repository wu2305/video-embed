import { useLayoutEffect, useRef, useState } from "react";
import "./gallery.css";

export interface PagePreview {
  /** Story id, e.g. "pages-search--results". */
  id: string;
  title: string;
  note?: string;
}

export interface PageGroup {
  title: string;
  /** Render size of each preview before scaling. Defaults to a 1280 x 800 desktop. */
  device?: { width: number; height: number };
  pages: readonly PagePreview[];
}

type ThemeChoice = "both" | "dark" | "light";
const DESKTOP = { width: 1280, height: 800 };

/** The manager URL for a story, so a preview can open it full size. */
function storyHref(id: string): string {
  let base = "/";
  try {
    base = window.top?.location.pathname ?? "/";
  } catch {
    // Embedded cross-origin: fall back to the root.
  }
  return `${base}?path=/story/${id}`;
}

/** One live page, rendered at device size in an iframe and scaled to fit its tile. */
function Frame({ id, theme, device, title }: { id: string; theme: "dark" | "light"; device: { width: number; height: number }; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setScale(entry.contentRect.width / device.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [device.width]);

  return (
    <figure className="pg-frame">
      <div ref={box} className="pg-screen" data-theme="dark" style={{ aspectRatio: `${device.width} / ${device.height}` }}>
        <iframe
          title={`${title}, ${theme} theme`}
          src={`iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`}
          loading="lazy"
          tabIndex={-1}
          style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}
        />
      </div>
      <figcaption>{theme}</figcaption>
    </figure>
  );
}

/** A wall of live page previews, grouped, in dark, light or both. Click a tile to open its story. */
export function PageGallery({ groups }: { groups: readonly PageGroup[] }) {
  const [choice, setChoice] = useState<ThemeChoice>("both");
  const themes = choice === "both" ? (["dark", "light"] as const) : ([choice] as const);

  return (
    <div className="pg" data-theme="light">
      <div className="pg-bar" role="group" aria-label="Theme">
        {(["both", "dark", "light"] as const).map((c) => (
          <button key={c} type="button" aria-pressed={choice === c} onClick={() => setChoice(c)}>
            {c === "both" ? "Dark and light" : c === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
      {groups.map((group) => {
        const device = group.device ?? DESKTOP;
        const phone = device.width < 600;
        return (
          <section key={group.title} className="pg-group">
            <h2>{group.title}</h2>
            <div className={`pg-grid${phone ? " phone" : ""}${themes.length === 1 ? " single" : ""}`}>
              {group.pages.map((page) => (
                <a key={page.id} className="pg-tile" href={storyHref(page.id)} target="_top">
                  <div className="pg-frames">
                    {themes.map((t) => <Frame key={t} id={page.id} theme={t} device={device} title={page.title} />)}
                  </div>
                  <div className="pg-meta">
                    <strong>{page.title}</strong>
                    {page.note && <span>{page.note}</span>}
                  </div>
                </a>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
