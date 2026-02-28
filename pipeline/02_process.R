#!/usr/bin/env Rscript
# 02_process.R — Clean SDWIS water quality data and produce JSON for the frontend
#
# Inputs:  data/raw/SDWIS4.tab, data/raw/safer_risk.csv
# Outputs: site/data/systems_summary.json  (all systems, for map)
#          site/data/systems/{id}.json      (per-system detail)
#
# Strategy:
#   - Use data.table for memory-efficient processing of 1.8 GB SDWIS4
#   - Filter to community water systems with samples in the last 2 years
#   - Compute average contaminant levels per system per analyte
#   - Compare to MCLs and flag exceedances
#   - Join with SAFER for compliance status and coordinates
#   - Export compact JSON for static site consumption

library(data.table)
library(jsonlite)

cat("=== Processing water quality data ===\n")
cat("Start time:", format(Sys.time()), "\n\n")

# --- Configuration ---
RAW_DIR <- "data/raw"
OUT_DIR <- "site/data"
SYSTEMS_DIR <- file.path(OUT_DIR, "systems")
dir.create(SYSTEMS_DIR, recursive = TRUE, showWarnings = FALSE)

# Only include samples from the last 2 years
CUTOFF_DATE <- Sys.Date() - 365 * 2

# --- 1. Load SAFER risk assessment (compliance + coordinates) ---
cat("[1/5] Loading SAFER risk assessment...\n")
safer <- fread(file.path(RAW_DIR, "safer_risk.csv"),
  select = c(
    "WATER_SYSTEM_NUMBER", "SYSTEM_NAME", "COUNTY",
    "FEDERAL_CLASSIFICATION_TYPE", "POPULATION", "SERVICE_CONNECTIONS",
    "LATITUDE_MEASURE", "LONGITUDE_MEASURE",
    "FINAL_SAFER_STATUS", "CURRENT_FAILING",
    "PRIMARY_MCL_VIOLATION", "SECONDARY_MCL_VIOLATION",
    "E_COLI_VIOLATION", "TREATMENT_TECHNIQUE_VIOLATION",
    "WATER_QUALITY_RISK_LEVEL", "PRIMARY_ANALYTES",
    "OWNER_TYPE", "PL_ADDRESS_CITY_NAME"
  ),
  col.names = c(
    "system_id", "system_name", "county",
    "classification", "population", "connections",
    "lat", "lon",
    "safer_status", "currently_failing",
    "primary_mcl_violation", "secondary_mcl_violation",
    "ecoli_violation", "treatment_technique_violation",
    "water_quality_risk", "primary_analytes",
    "owner_type", "city"
  )
)

# Filter to community water systems
safer <- safer[classification == "COMMUNITY"]
cat("  Community water systems:", nrow(safer), "\n")

# --- 2. Load SDWIS4 water quality results ---
cat("[2/5] Loading SDWIS4 water quality results (this may take a minute)...\n")

# Some lines have 30 fields instead of 29 (trailing tab). Strip extra fields
# via awk preprocessing so fread can parse the entire file.
sdwis_raw <- fread(
  cmd = "awk -F'\\t' 'BEGIN{OFS=\"\\t\"} {NF=29; print}' data/raw/SDWIS4.tab",
  sep = "\t", header = TRUE, fill = TRUE
)
cat("  Total records loaded:", format(nrow(sdwis_raw), big.mark = ","), "\n")

# Select and rename columns
keep_cols <- c(
  "Water System Number", "Analyte Code", "Analyte Name",
  "Result", "Units of Measure", "Less Than Reporting Level",
  "Reporting Level", "DLR", "MCL",
  "Sample Date", "Sample Type"
)
sdwis <- sdwis_raw[, ..keep_cols]
setnames(sdwis, c(
  "system_id", "analyte_code", "analyte_name",
  "result", "units", "below_rl",
  "reporting_level", "dlr", "mcl",
  "sample_date", "sample_type"
))
rm(sdwis_raw)
gc(verbose = FALSE)

# Coerce result columns to numeric (they may be read as character)
for (col in c("result", "reporting_level", "dlr", "mcl")) {
  if (is.character(sdwis[[col]])) {
    sdwis[, (col) := as.numeric(get(col))]
  }
}

# Parse dates and filter to last 2 years
sdwis[, sample_date := as.IDate(sample_date, format = "%m-%d-%Y")]
sdwis <- sdwis[!is.na(sample_date) & sample_date >= CUTOFF_DATE]
cat("  Records in last 2 years:", format(nrow(sdwis), big.mark = ","), "\n")

# Only keep records for community water systems
sdwis[, system_id := trimws(system_id)]
sdwis <- sdwis[system_id %chin% safer$system_id]
cat("  Records for community systems:", format(nrow(sdwis), big.mark = ","), "\n")

# --- 3. Compute per-system contaminant summaries ---
cat("[3/5] Computing contaminant summaries...\n")

# Flag non-detects: below_rl == "Y" or result is NA
sdwis[, is_detect := (below_rl != "Y" | is.na(below_rl)) & !is.na(result)]

# For each system + analyte, compute summary stats
analyte_summary <- sdwis[, .(
  n_samples     = .N,
  n_detects     = sum(is_detect, na.rm = TRUE),
  avg_result    = fifelse(sum(is_detect, na.rm = TRUE) > 0,
                          mean(result[is_detect], na.rm = TRUE), NA_real_),
  max_result    = fifelse(sum(is_detect, na.rm = TRUE) > 0,
                          max(result[is_detect], na.rm = TRUE), NA_real_),
  mcl           = first(mcl[!is.na(mcl)]),
  dlr           = first(dlr[!is.na(dlr)]),
  units         = first(units[trimws(units) != ""]),
  latest_sample = max(sample_date, na.rm = TRUE)
), by = .(system_id, analyte_code, analyte_name)]

# Only keep analytes with at least one detection OR an MCL (to show compliance)
analyte_summary <- analyte_summary[n_detects > 0 | !is.na(mcl)]

# Flag MCL exceedances (only where both MCL and avg_result exist)
analyte_summary[, exceeds_mcl := !is.na(mcl) & mcl > 0 &
                                 !is.na(avg_result) & avg_result > mcl]

# Count exceedances per system
system_exceedances <- analyte_summary[exceeds_mcl == TRUE, .(
  n_exceedances = .N,
  exceeding_analytes = paste(analyte_name, collapse = "; ")
), by = system_id]

cat("  Unique system-analyte combinations:", format(nrow(analyte_summary), big.mark = ","), "\n")
cat("  Systems with MCL exceedances:", nrow(system_exceedances), "\n")

# --- 4. Build system summary for map ---
cat("[4/5] Building system summary for map...\n")

# Merge SAFER data with exceedance info
map_data <- merge(safer, system_exceedances, by = "system_id", all.x = TRUE)
map_data[is.na(n_exceedances), n_exceedances := 0L]
map_data[is.na(exceeding_analytes), exceeding_analytes := ""]

# Count how many analytes were tested per system
analytes_tested <- analyte_summary[, .(n_analytes_tested = .N), by = system_id]
map_data <- merge(map_data, analytes_tested, by = "system_id", all.x = TRUE)
map_data[is.na(n_analytes_tested), n_analytes_tested := 0L]

# Determine display status for map coloring
# Start with SAFER assessment, then derive status from MCL data for unassessed systems
map_data[, display_status := fcase(
  currently_failing == "Failing", "Failing",
  safer_status == "At-Risk", "At-Risk",
  safer_status == "Potentially At-Risk", "Potentially At-Risk",
  safer_status == "Not At-Risk", "In Compliance",
  default = "Not Assessed"
)]

# Override "Not Assessed" using actual MCL exceedance data from SDWIS4
n_before <- sum(map_data$display_status == "Not Assessed")
map_data[display_status == "Not Assessed" & n_exceedances > 0,
         display_status := "Failing"]
map_data[display_status == "Not Assessed" & n_exceedances == 0 & n_analytes_tested > 0,
         display_status := "In Compliance"]
n_after <- sum(map_data$display_status == "Not Assessed")
cat("  Derived status for", n_before - n_after, "of", n_before,
    "previously unassessed systems\n")

cat("  Map status distribution:\n")
print(table(map_data$display_status))

# Export map summary JSON (compact format for fast loading)
summary_list <- lapply(seq_len(nrow(map_data)), function(i) {
  row <- map_data[i]
  list(
    id   = row$system_id,
    name = row$system_name,
    lat  = round(row$lat, 4),
    lon  = round(row$lon, 4),
    county    = row$county,
    city      = row$city,
    pop       = row$population,
    status    = row$display_status,
    n_exceed  = row$n_exceedances,
    n_tested  = row$n_analytes_tested
  )
})

summary_json <- toJSON(summary_list, auto_unbox = TRUE, digits = 4)
writeLines(summary_json, file.path(OUT_DIR, "systems_summary.json"))
summary_size <- file.size(file.path(OUT_DIR, "systems_summary.json")) / 1024
cat("  systems_summary.json:", round(summary_size), "KB\n")

# --- 5. Export per-system detail JSON ---
cat("[5/5] Exporting per-system detail files...\n")

system_ids <- unique(map_data$system_id)
n_exported <- 0L

for (sid in system_ids) {
  sys_info <- map_data[system_id == sid]
  sys_analytes <- analyte_summary[system_id == sid]

  # Build analyte list, sorted by whether they exceed MCL then by name
  if (nrow(sys_analytes) > 0) {
    setorder(sys_analytes, -exceeds_mcl, analyte_name)
    contaminants <- lapply(seq_len(nrow(sys_analytes)), function(j) {
      a <- sys_analytes[j]
      out <- list(
        code      = a$analyte_code,
        name      = a$analyte_name,
        avg       = round(a$avg_result, 4),
        max       = round(a$max_result, 4),
        units     = a$units,
        n_samples = a$n_samples,
        n_detects = a$n_detects,
        latest    = as.character(a$latest_sample)
      )
      if (!is.na(a$mcl)) out$mcl <- a$mcl
      if (!is.na(a$dlr)) out$dlr <- a$dlr
      if (isTRUE(a$exceeds_mcl)) out$exceeds_mcl <- TRUE
      out
    })
  } else {
    contaminants <- list()
  }

  detail <- list(
    system_id    = sys_info$system_id,
    system_name  = sys_info$system_name,
    county       = sys_info$county,
    city         = sys_info$city,
    population   = sys_info$population,
    connections  = sys_info$connections,
    owner_type   = sys_info$owner_type,
    owner_type   = sys_info$owner_type,
    status       = sys_info$display_status,
    safer_status = sys_info$safer_status,
    failing      = sys_info$currently_failing,
    primary_mcl_violation = sys_info$primary_mcl_violation,
    lat = sys_info$lat,
    lon = sys_info$lon,
    contaminants = contaminants
  )

  # Use system ID without CA prefix for filename
  file_id <- sub("^CA", "", sid)
  write(toJSON(detail, auto_unbox = TRUE, digits = 4),
        file.path(SYSTEMS_DIR, paste0(file_id, ".json")))
  n_exported <- n_exported + 1L
}

cat("  Exported", n_exported, "system detail files\n")

# --- Summary ---
# Write data freshness metadata
meta <- list(
  updated  = format(Sys.Date(), "%Y-%m-%d"),
  systems  = nrow(map_data),
  records  = nrow(sdwis),
  cutoff   = as.character(CUTOFF_DATE)
)
write(toJSON(meta, auto_unbox = TRUE),
      file.path(OUT_DIR, "meta.json"))
cat("  meta.json written (updated:", meta$updated, ")\n")

total_size_mb <- sum(file.size(list.files(OUT_DIR, recursive = TRUE, full.names = TRUE))) / 1024^2
cat("\n=== Processing complete ===\n")
cat("Total output size:", round(total_size_mb, 1), "MB\n")
cat("End time:", format(Sys.time()), "\n")
