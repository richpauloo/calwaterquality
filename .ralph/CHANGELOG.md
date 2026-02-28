# Ralph Changelog

## Iteration 89 — 2026-02-28
- What: **Added "Nearby Water Systems" section to detail panel.** When viewing a system, the 5 closest systems now appear at the bottom of the panel with status dots, names, distances, and population. Each is tappable to navigate directly. Extracted Haversine into a shared helper (was duplicated in `findNearestSystem`).
- Why: When a user sees their water system is failing, the natural next question is "is it just mine, or is this area-wide?" The nearby list answers that instantly — if 3 of 5 neighbors are also red, it's a regional issue. Also enables casual exploration of systems near a school, workplace, etc.
- Result: JS syntax valid. Two files changed: `js/app.js` (nearby section in `renderSystemDetail`, `findNearbySystems` + `haversine` helpers, click handlers), `css/style.css` (nearby list styling). Pushed to deploy.

## Iteration 88 — 2026-02-28
- What: **Color-coded map clusters by water quality.** Clusters now reflect the proportion of failing systems they contain: green (<10% failing), amber (10–24%), orange (25–44%), red (45%+). Uses MapLibre's `clusterProperties` to aggregate a `fail_count` across clustered features, then divides by `point_count` to compute the fail ratio. Same status colors as the rest of the app (green/amber/orange/red).
- Why: Iteration 87 added clustering, but all clusters were uniform blue — they showed *how many* systems existed in a region but nothing about *water quality*. Now users landing on the statewide map immediately see regional water quality patterns: green clusters = safe areas, red/orange clusters = areas with many failing systems. This is the "weather map for water quality" vision in action.
- Result: JS syntax valid. One file changed: `js/app.js` (added `clusterProperties` to source, replaced blue step-by-count color expression with status-colored step-by-fail-ratio). Pushed to deploy.

## Iteration 87 — 2026-02-28
- What: **Added map clustering.** At the default statewide zoom, nearby systems are now grouped into numbered blue clusters (sized by count). Clicking a cluster zooms in to reveal individual systems. Unclustered systems retain their status-colored dots at zoom 12+. Updated the first-visit hint text from "Each dot is a community water system" to "Tap a cluster to zoom in, or search above to find your water system."
- Why: At zoom 5.5, 2,816 dots overlapped heavily in urban areas like LA, SF, and Sacramento — the map was an unreadable blob. Clustering makes the statewide view immediately navigable and gives users a sense of how many systems exist in each region. This is the biggest remaining map UX improvement.
- Result: JS syntax valid. Two files changed: `js/app.js` (cluster source options, 3 new layers, cluster click/cursor handlers, glyphs URL), `index.html` (hint text). Pushed to deploy.

## Iteration 86 — 2026-02-28
- What: **Added first-visit map hint.** A floating card appears above the "Find My Water System" button after data loads, reading "Each dot is a community water system. Tap one to check its water quality." Auto-dismisses after 8 seconds or on first interaction (map click, search focus, Find button press). Skipped for deep-link arrivals.
- Why: First-time visitors landed on a map of colored dots with zero guidance — no explanation of what the dots represent or that they're tappable. The instruction text existed but was hidden in the off-screen panel. This bridges the gap between landing and first interaction.
- Result: JS syntax valid. Three files changed: `index.html` (hint element), `css/style.css` (hint positioning/styling), `js/app.js` (initMapHint + dismissal logic). Pushed to deploy.

## Reflection — Iteration 85 — 2026-02-28
- Trajectory: **On track. Best run of productive iterations since the v1 launch.**
- Working: Iterations 81–84 each delivered a focused, user-facing UX improvement — truncation indicator (81), peak values & last-tested dates (82), severity badges (83), named exceedances in summary text (84). Every change directly answers the core question "is my water safe?" more clearly. All were pushed to deploy. The detail panel is now genuinely interpretable: a user sees which contaminants exceed limits by name, how severely (2.5x badge), what the peak was, and when it was last tested. This is the product's core value proposition, and it's working.
- Not working: The four human actions remain pending (GoatCounter, share site, custom domain, Search Console). Zero confirmed users. The scheduled pipeline's first run (March 1) hasn't happened yet — that will be the first real test of automated data freshness.
- Spiraling? **No.** The last 5 coding iterations were all distinct, impactful, and shipped. No meta-work, no health checks, no repeated reflections. This is the right mode.
- User impact: Significantly improved since iteration 80. A person viewing a failing system now gets: named contaminants in the summary, severity badges on each card, peak values, and last-tested dates. The information density and clarity are dramatically better than 5 iterations ago.
- Next 5 iterations should focus on: **(1) Monitor the March 1 pipeline run** — if it fails, fix it immediately (data freshness is critical). **(2) Continue targeted UX improvements if high-impact ones exist**, but don't force them — the detail panel is in good shape. **(3) Consider broader UX areas**: the map experience, first-visit onboarding, or "Find My Water System" flow could use attention. **(4) Human actions remain the distribution bottleneck** — code can't fix that.
- Adjustments: The "commit AND push" discipline from iteration 80's reflection is working — keep it. Shift focus from the detail panel (well-refined now) to other user touchpoints if high-impact work exists.

## Iteration 84 — 2026-02-28
- What: **Named exceeding contaminants in summary text.** When a system has failing contaminants, the summary now says e.g. "Manganese exceeds California safety limits" instead of the generic "1 contaminant exceeds..." Names are sorted by severity (worst first), showing up to 3 for systems with many exceedances.
- Why: The summary is the first thing users read in the detail panel. Naming the contaminant answers "what's wrong?" without requiring the user to scroll to the contaminant cards below. For Alameda County Water District (3 exceedances), it now reads "3 contaminants — Manganese, Color, Odor — exceed California safety limits."
- Result: JS syntax valid. One file changed: `js/app.js` (summary text logic + moved exceeding sort earlier). Pushed to deploy.

## Iteration 83 — 2026-02-28
- What: **Added severity labels to contaminant cards.** Exceeding contaminants now show a red "2.5x above limit" badge next to the name. Contaminants between 80-100% of the MCL show an amber "85% of limit" badge. Users no longer need to compare raw numbers mentally.
- Why: When a contaminant exceeds its safety limit, the raw numbers (e.g., "Average: 128 µg/L · Limit: 50 µg/L") require mental math. "2.6x above limit" is instantly understandable and communicates severity at a glance — critical for the "is my water safe?" use case.
- Result: JS syntax valid. Two files changed: `js/app.js` (severity badge in `renderContaminantBar`), `css/style.css` (`.severity-badge` styling). Pushed to deploy.

## Iteration 82 — 2026-02-28
- What: **Added peak values and last-tested dates to contaminant cards.** Each contaminant now shows its peak (max) detected value alongside the average, and the date it was last tested. For "no MCL" chip details, the same info is shown on tap.
- Why: The average alone hides important risk information. For Alameda County Water District, manganese averages 128 µg/L (2.5x the MCL) but peaked at 491 µg/L (10x the MCL) — that spike matters to users. The last-tested date gives recency context so users know whether data is fresh.
- Result: JS syntax valid. Two files changed: `js/app.js` (peak value + last-tested in `renderContaminantBar` and chip detail handler), `css/style.css` (`.contaminant-samples` and `.chip-detail-tested` styles). Pushed to deploy.

## Iteration 81 — 2026-02-28
- What: **Added search result truncation indicator.** When searching a county like "Los Angeles" (200 systems), only 20 results are shown. Now a "Showing 20 of 200 results — refine your search" message appears at the bottom of the dropdown, so users know they're seeing a subset.
- Why: Users searching for broad terms (county names) had no indication that results were truncated. A user searching "Los Angeles" would see 20 results and assume that was all, missing 180 other systems. This helps them understand they should search more specifically.
- Result: JS syntax valid. Two files changed: `js/app.js` (doSearch refactored to track total matches, truncation indicator added, keyboard nav excludes indicator), `css/style.css` (search-truncated styling). Pushed to deploy.

## Reflection — Iteration 80 — 2026-02-28
- Trajectory: **Resumed with real UX work. But not deployed.**
- Working: After 35 iterations of pause/reflections, iterations 78-79 made genuine user-facing improvements: status dots in search results and system counts in the map legend. Both are small, focused, and directly improve first-visit comprehension. Site live (200, 46ms). Pipeline scheduled.
- Not working: **Iterations 78-79 are unpushed.** Same pattern as iteration 65 (which sat undeployed until iteration 72 force-pushed it). Working code that isn't live doesn't help users. The four human actions remain pending: GoatCounter, share site, custom domain, Search Console.
- Spiraling? No — the pause correctly ended when there was real UX work to do. But the push-to-deploy step keeps getting skipped.
- User impact: Improvements exist locally but aren't live. The deployed site is the same as after iteration 72.
- Next 5 iterations should focus on: **(1) Push iterations 78-79 live.** That's the single highest-impact action right now — it's free and immediate. **(2) Stop making changes without deploying them.** Every code iteration should end with a push. **(3) If product owner provides direction, execute it.** Otherwise, the four human actions remain the bottleneck.
- Adjustments: Adopt a "commit AND push" discipline. Unpushed code is unshipped code.
