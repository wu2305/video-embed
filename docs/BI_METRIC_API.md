# BI metric search — gateway API

The console's contract for the BI source (STORYBOOK.md scene 4f). Users search
for a metric and see which reports use it. The gateway owns these two endpoints
and talks to the BI platform behind them. How it does that (the platform's own
API, a nightly catalogue export, or lineage tables) stays inside the adapter,
as long as these responses hold. The Storybook types `MetricRecord` and
`MetricReport` (`storybook/src/types.ts`) match this document field for field.

## Rules for both endpoints

- **Caller identity.** The gateway resolves the signed-in user as it does for
  the other sources (design doc §5) and returns only reports that user may open
  in the BI platform. `report_count` counts those reports only. A metric is
  left out when the user can open none of its reports.
- **Times** are epoch seconds. **Links** are absolute URLs into the BI
  platform, which checks access again when they are opened.
- **Errors** use `{ "error": { "code": string, "message": string } }`. If the
  BI platform has not answered within 3 s, the gateway returns 504 with
  `code: "bi_timeout"`. The console then shows the other sources and warns
  that the BI results are missing.

## 1. Search metrics

```
GET /api/bi/metrics?q=<text>&limit=<n>
```

| Param | Notes |
|---|---|
| `q` | The *what* of the query. The gateway strips person names before it calls this, as it does for the Archive. |
| `limit` | Default 12, max 50. |

Matches the metric name, aliases, `metric_id` and definition. Results come back
in the BI side's ranking. The gateway fuses them with the other sources by rank
(reciprocal rank fusion), never by score.

```json
{
  "metrics": [
    {
      "source": "bi",
      "metric_id": "hotel.revpar",
      "name": "RevPAR",
      "domain": "Hotels",
      "owner": "Lena Vogt",
      "definition": "Room revenue ÷ available room nights",
      "report_count": 7,
      "reports": [
        {
          "report_id": "R-1042",
          "title": "Monthly hotel P&L",
          "kind": "report",
          "folder": "Finance / Close",
          "owner": "Raj Patel",
          "charts": 4,
          "updated_at": 1792519200,
          "deep_link": "https://bi.example.internal/reports/R-1042"
        }
      ],
      "deep_link": "https://bi.example.internal/metrics/hotel.revpar",
      "vendor_rank": 1
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `metric_id` | string | Stable id. Used in the reports URL. |
| `name` | string | Display name. |
| `domain`, `owner`, `definition` | string, optional | Left out when unknown. |
| `report_count` | int | Reports the caller may open. |
| `reports` | MetricReport[] | The top reports, **at most 3**, by `charts` then `updated_at`. The card shows these. |
| `deep_link` | url | The metric's page in the BI platform. |
| `vendor_rank` | int | 1-based position in this response. |

**MetricReport**

| Field | Type | Notes |
|---|---|---|
| `report_id` | string | |
| `title` | string | |
| `kind` | `"report"` \| `"dashboard"` | |
| `folder`, `owner` | string, optional | Folder or workspace path; owner display name. |
| `charts` | int | Charts or tables in the report that use the metric. At least 1. |
| `updated_at` | int | Last modified. |
| `deep_link` | url | Opens the report. |

## 2. Reports that use a metric

```
GET /api/bi/metrics/{metric_id}/reports?q=<text>&offset=<n>&limit=<n>
```

Called when the user opens a metric's preview, and again for each page or
filter. It returns one page of the reports the caller may open, in the same
order as the card's top reports. A metric can be used by hundreds of reports,
so the console never asks for all of them at once.

| Param | Notes |
|---|---|
| `q` | Optional. Filters on title, folder and owner. The preview's filter field shows from 6 reports up and sends `q` once typing pauses for 250 ms. A new `q` starts again at `offset=0`. |
| `offset` | Position of the first report to return. Default 0. |
| `limit` | Default 10, max 100. The console asks for 10. |

```json
{ "reports": [ /* MetricReport */ ], "total": 34 }
```

`total` counts every report that matches `q` (all of them when `q` is empty, so
it equals the metric's `report_count`). The console shows "11–20 of 34" with
Previous and Next, and needs `total` for that. Offsets rather than cursors,
because Previous and the range need random access and one metric's report list
is small enough to count. An `offset` past the end returns an empty `reports`
with the same `total`. Unknown `metric_id` → 404 `code: "metric_not_found"`.

## Console states this must support

| State | Endpoint | Console |
|---|---|---|
| Metric with reports | 1 | Card: name, id, domain, definition; reports only in the preview |
| Preview loading | 2 | Top 3 stay, placeholder below |
| Preview failed | 2 | "Could not load the reports." + Try again |
| Filter with no match | 2 (`q`) | "No reports match." |
| BI timeout | 1 | Other sources show; warning that BI did not respond |
| More than 10 reports | 2 (`offset`) | Pager under the list: Previous, "11–20 of 34", Next |
| Next page loading | 2 (`offset`) | Placeholder rows; Previous and Next wait |
