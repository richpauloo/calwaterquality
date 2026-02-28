# California Water Quality

Check drinking water quality for any community water system in California. Free, open-source, updated monthly.

**[View the live site](https://richpauloo.github.io/calwaterquality/)**

## What this does

A consumer-friendly web app that helps Californians understand their drinking water quality. Search by name, city, or county — or use geolocation to find your nearest water system. See compliance status, detected contaminants with plain-language explanations, and how results compare to state and federal standards.

Covers all **2,816 community water systems** in California.

## How it works

- **Data source**: California State Water Resources Control Board (SDWIS database), refreshed automatically on the 1st and 15th of each month via GitHub Actions
- **Data processing**: R scripts download, clean, and transform raw water quality records into compact JSON
- **Frontend**: Vanilla HTML/CSS/JS with MapLibre GL for the map. No framework, no build step
- **Deployment**: GitHub Pages via GitHub Actions

## Project structure

```
pipeline/          R scripts for data download and processing
site/              Static site (HTML, CSS, JS, JSON data)
  data/            Processed JSON files served to the frontend
  js/app.js        Application logic
  css/style.css    Styles
  index.html       Single-page app entry point
.github/workflows/ Automated data refresh and deploy pipelines
```

## License

MIT

## Author

Rich Pauloo — [richpauloo.com](https://richpauloo.com)
