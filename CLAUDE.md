# Persistent Learnings

## Data Sources
- SDWIS4.tab from EDT Library is the primary water quality data source (tab-delimited, ~1.8 GB, updated twice monthly)
- Old FTP server (ftp.waterboards.ca.gov) requires auth now — use direct HTTP downloads from EDT Library instead
- SAFER risk assessment CSV from data.ca.gov has lat/lon coordinates and compliance status for all community water systems
- SDWIS4.tab has some malformed rows (30 fields vs 29) — use awk preprocessing to truncate before fread

## Data Processing
- SDWIS4 dates are MM-DD-YYYY format (dashes, not slashes)
- ~77% of water quality samples are non-detects (result=NA, below_rl="Y") — only show detected contaminants
- 2,816 community water systems in California, 3.7M test records in last 2 years
- Total JSON output is ~23 MB (vs ~9 GB for old per-system HTML approach)

## Architecture
- data/raw/ holds downloaded files (gitignored, re-downloadable)
- site/data/ holds processed JSON for frontend consumption
- site/data/systems_summary.json (~512 KB) for map, site/data/systems/{id}.json for detail pages

## Frontend UX
- titleCase() has ABBR_KEEP list for abbreviations (DWP, EBMUD, PFOS etc.) — add new ones as needed
- contaminant_dict.json (148 entries) maps raw chemical names → plain-language display, health info, sources
- "Find My Water System" button uses geolocation + Haversine nearest-neighbor over all 2,816 systems
- Panel states: closed (default) → peek (summary visible) → open (full scroll) — driven by setPanel()
- deriveStatus() in frontend + pipeline overrides "Not Assessed" using MCL exceedance data — only 3 of 2,816 systems truly unassessed
- All unit abbreviations mapped in contaminant_dict.json `_units`: μg/L, mg/L, ng/L, pCi/L, MFL, NTU, pH, μmhos/cm, °C. Unitless indices (AGGR, LANG, TON) display with no unit suffix. fmtUnits() uses `in` check to respect empty-string mappings.
- Accessibility: ARIA landmarks (banner/search/complementary/region/application), keyboard nav (Escape closes panel, Enter/Space on drag handle), focus management, `:focus-visible` outlines
- GitHub Actions `refresh-data.yml` runs on 1st and 15th for data refresh — validated, runs in ~6 min, needs libcurl4-openssl-dev system dep
- GITHUB_TOKEN pushes don't trigger other workflows — refresh-data.yml explicitly dispatches deploy.yml after committing
- Product is feature-complete for v1 and deployed — future features should be driven by real user feedback, not assumptions
- Site deployed at richpauloo/calwaterquality via GitHub Actions — live at https://richpauloo.github.io/calwaterquality/
- Custom domain calwaterquality.com still claimed by caccr/caccr.github.io — CNAME file removed from site/, needs user-level domain verification in GitHub Settings > Pages before re-adding
- Feedback issue links now point to richpauloo/calwaterquality (updated from caccr/caccr.github.io)
- Site is at a subdirectory (`/calwaterquality/`) — all asset paths must be relative (no leading `/`), OG meta tags need full absolute URL
- Two remotes: `origin` (caccr/caccr.github.io, read-only) and `deploy` (richpauloo/calwaterquality, pushable) — always push to `deploy`
- GoatCounter analytics at calwaterquality.goatcounter.com — free for open-source, privacy-friendly, no cookie banner needed. Requires one-time signup at goatcounter.com to activate.
- SEO files: robots.txt, sitemap.xml, and JSON-LD (WebApplication schema) in site/ — all deployed automatically via the site/ directory upload
- Development paused at iteration 40 (2026-02-28) — resume only on: (a) user feedback, (b) pipeline failure, or (c) product owner direction. Human actions pending: activate GoatCounter, share site, verify custom domain.
