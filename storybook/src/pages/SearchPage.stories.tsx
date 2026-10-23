import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { SearchPage } from "./SearchPage";
import { archiveRecords, metricRecords, metricReports, audioHit, documentHit, hits, indexInfo, now, people, viewer } from "../mock/data";

const corpus = [...hits, audioHit, documentHit];

const meta = {
  title: "Pages/Search",
  component: SearchPage,
  parameters: { layout: "fullscreen" },
  args: { people, corpus, archive: archiveRecords, metrics: metricRecords, metricReports, index: indexInfo, now, viewer, onNavigate: fn(), onOpenClip: fn() },
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** First visit: a search home. The brand, one large field, example queries, and when the index was last updated. */
export const FirstVisit: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Unified Search" })).toBeInTheDocument();
    await expect(canvas.queryByLabelText("limit")).toBeNull();
    // Brand, field and the freshness line only: no explanation, no example queries.
    await expect(canvas.queryByText(/allowed to open/)).toBeNull();
    await expect(canvasElement.querySelectorAll(".mm-home .mm-hint")).toHaveLength(0);
    await expect(canvas.getAllByRole("button").map((b) => b.textContent)).not.toContain("Ana is cooking");
  },
};

/** Submitting from the home moves to the results layout with the query kept. */
export const SearchFromHome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search" }), "Ana and Ben are cooking");
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/^\d+ results$/);
    await expect(canvas.getByLabelText("Search")).toHaveValue("Ana and Ben are cooking");
  },
};

/** A name plus an action: NAS clips with Ana, fused with Archive records about cooking. */
export const Results: Story = { args: { initialQuery: "Ana is cooking" } };

/** Opening a hit previews the matched scene. ← → step through NAS hits only, Esc closes. */
export const PreviewOpen: Story = {
  args: { initialQuery: "Ana is cooking", openId: 101 },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open clip" }));
    await expect(args.onOpenClip).toHaveBeenCalledWith(expect.objectContaining({ unit_id: 101 }));
  },
};

/** The preview is a modal: it takes focus, keeps Tab inside, and Esc returns focus to the card. */
export const PreviewKeyboard: Story = {
  args: { initialQuery: "Ana is cooking", openId: 101 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole("dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog).toHaveFocus());
    await expect(canvasElement.querySelector(".mm-shell")).toHaveAttribute("inert");
    for (let i = 0; i < 12; i++) {
      await userEvent.tab();
      await expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvasElement.querySelector(".mm-shell")).not.toHaveAttribute("inert");
    await waitFor(() => expect(canvasElement.querySelector('[data-unit-id="101"] .mm-card-link')).toHaveFocus());
  },
};

/** Video, photo, audio and documents in one list; things without a frame show a glyph. */
export const MixedMedia: Story = { args: { initialQuery: "cooking", archive: [], metrics: [] } };

/** NAS and Archive results fused by rank, with a source filter. */
export const BothSources: Story = {
  args: { initialQuery: "cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The source split lives on the filter chips, not repeated in the status line.
    await expect(canvas.getByRole("status")).not.toHaveTextContent(/NAS \d/);
    await expect(canvas.getByRole("button", { name: /^NAS media \(6\)/ })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /^Archive \(2\)/ }));
    await expect(canvas.getAllByRole("article")).toHaveLength(2);
  },
};

/** A metric name with no matching media: BI metric cards, each with its top reports. */
export const MetricSearch: Story = {
  args: { initialQuery: "revenue", corpus: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("2 results");
    const card = canvas.getByRole("button", { name: "Net revenue" }).closest("article")!;
    await expect(card).toHaveTextContent("+4 more");
    // A report link opens the report in BI; it is not covered by the card's button.
    await expect(within(card as HTMLElement).getByRole("link", { name: "Monthly P&L" })).toHaveAttribute("href", "https://bi.example.internal/reports/R-1042");
  },
};

/** Clicking a metric opens its preview on the same page: every report, a filter, and Open in BI. Esc returns to the card. */
export const MetricPreviewOpen: Story = {
  args: { initialQuery: "revenue", corpus: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Net revenue" }));
    const dialog = canvas.getByRole("dialog", { name: "Preview Net revenue" });
    await expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Filter reports" }), "raj");
    await expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    await expect(within(dialog).getByRole("link", { name: "Open in BI ↗" })).toHaveAttribute("href", "https://bi.example.internal/metrics/fin.net_revenue");
    await expect(canvasElement.querySelector(".mm-shell")).toHaveAttribute("inert");
    await userEvent.keyboard("{Escape}");
    await expect(canvas.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(canvas.getByRole("button", { name: "Net revenue" })).toHaveFocus());
  },
};

/** The report list is still loading: the card's top reports show, with a placeholder under them. */
export const MetricReportsLoading: Story = {
  args: { initialQuery: "revenue", corpus: [], metricReports: {}, openMetricId: "fin.net_revenue" },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement).getByRole("dialog");
    await expect(within(dialog).getByRole("region", { name: "Reports" })).toHaveAttribute("aria-busy", "true");
    await expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
  },
};

/** The reports request failed: the card's top reports stay, with Try again. */
export const MetricReportsFailed: Story = {
  args: { initialQuery: "revenue", corpus: [], metricReportsError: true, openMetricId: "fin.net_revenue" },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement).getByRole("dialog");
    await expect(within(dialog).getByRole("alert")).toHaveTextContent("Could not load the reports.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await expect(within(dialog).getAllByRole("listitem")).toHaveLength(7);
  },
};

/** All three sources answer "cooking"; the filter gains a BI chip. */
export const ThreeSources: Story = {
  args: { initialQuery: "cooking" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^BI metrics \(1\)/ }));
    await expect(canvas.getAllByRole("article")).toHaveLength(1);
    await expect(canvas.getByRole("button", { name: "Cooking class attendance" })).toBeInTheDocument();
  },
};

/** The BI platform timed out: the other sources still show, with a warning. */
export const BiDown: Story = {
  args: { initialQuery: "revenue", biDown: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("The BI platform did not respond");
  },
};

/** The Archive System timed out: NAS results still show, with a warning. */
export const ArchiveDown: Story = {
  args: { initialQuery: "cooking", archiveDown: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("The Archive System did not respond");
  },
};

/** While a search runs, placeholders stand in for results; nothing stale reads as live. */
export const Loading: Story = {
  args: { initialQuery: "Ana is cooking", loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("region", { name: "Search results" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.queryAllByRole("article")).toHaveLength(0);
  },
};

/** A server error says what happened in plain words, offers Try again, and never shows the raw message. */
export const ServerError: Story = {
  args: { initialQuery: "Ana is cooking", error: "ValueError: query vector has 512 dims, index has 768" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("The search failed.");
    await expect(canvasElement).not.toHaveTextContent(/ValueError/);
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(canvas.getByRole("status")).toHaveTextContent(/^\d+ results$/);
  },
};
