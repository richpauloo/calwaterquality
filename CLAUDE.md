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
