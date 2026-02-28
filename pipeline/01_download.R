#!/usr/bin/env Rscript
# 01_download.R — Download SDWIS water quality data and reference tables
#
# Data sources:
#   - SDWIS4: Water quality analytical results (2023-present), updated twice monthly
#   - WATSYS: Water system info (name, address, type)
#   - SITELOC: Source/site location info
#   - PWS Facilities: System info with lat/lon from data.ca.gov
#   - SAFER Risk Assessment: Compliance/risk status from data.ca.gov

library(data.table)
library(curl)

# --- Configuration ---
RAW_DIR <- file.path("data", "raw")
dir.create(RAW_DIR, recursive = TRUE, showWarnings = FALSE)

BASE_URL <- "https://www.waterboards.ca.gov/drinking_water/certlic/drinkingwater/documents/edtlibrary"

downloads <- list(
  # Most recent water quality results (2023-present)
  list(
    url = file.path(BASE_URL, "SDWIS4.zip"),
    dest = file.path(RAW_DIR, "SDWIS4.zip"),
    desc = "SDWIS4 water quality results (2023-present)"
  ),
  # Water system reference table
  list(
    url = file.path(BASE_URL, "watsys_as_excel.zip"),
    dest = file.path(RAW_DIR, "watsys.zip"),
    desc = "WATSYS water system reference table"
  ),
  # Site/source location reference table
  list(
    url = file.path(BASE_URL, "siteloc_as_excel.zip"),
    dest = file.path(RAW_DIR, "siteloc.zip"),
    desc = "SITELOC site location reference table"
  ),
  # STORET chemical parameter codes (pre-2016 codes still used as reference)
  list(
    url = file.path(BASE_URL, "pre_2016_as_excel.zip"),
    dest = file.path(RAW_DIR, "storet.zip"),
    desc = "STORET chemical parameter reference table"
  )
)

# PWS facilities from data.ca.gov (has lat/lon coordinates)
pws_url <- "https://data.ca.gov/dataset/d6d3beac-6735-4127-9324-4e70f61698d9/resource/9dca2f92-4630-4bee-a9f9-69d2085b57e3/download/drinking-water-watch-public-water-system-facilities.csv"
downloads <- c(downloads, list(list(
  url = pws_url,
  dest = file.path(RAW_DIR, "pws_facilities.csv"),
  desc = "PWS facilities with coordinates (data.ca.gov)"
)))

# SAFER risk assessment (compliance status)
safer_url <- "https://data.ca.gov/dataset/ef20c688-98b6-4243-81b1-0aa42e940433/resource/255887bb-5451-4c19-8e35-27899ae8c3ad/download/safer-combined-ra.csv"
downloads <- c(downloads, list(list(
  url = safer_url,
  dest = file.path(RAW_DIR, "safer_risk.csv"),
  desc = "SAFER risk assessment (compliance status)"
)))

# --- Download ---
cat("=== Downloading water quality data ===\n")
cat("Target directory:", normalizePath(RAW_DIR, mustWork = FALSE), "\n\n")

for (dl in downloads) {
  if (file.exists(dl$dest)) {
    age_hours <- difftime(Sys.time(), file.mtime(dl$dest), units = "hours")
    if (age_hours < 24) {
      cat("[SKIP]", dl$desc, "(downloaded <24h ago)\n")
      next
    }
  }
  cat("[DOWN]", dl$desc, "\n")
  cat("       URL:", dl$url, "\n")
  tryCatch({
    curl_download(dl$url, dl$dest, quiet = FALSE)
    size_mb <- file.size(dl$dest) / 1024^2
    cat("       Size:", round(size_mb, 1), "MB\n\n")
  }, error = function(e) {
    cat("       ERROR:", conditionMessage(e), "\n\n")
  })
}

# --- Unzip ---
cat("=== Extracting zip files ===\n")
zip_files <- list.files(RAW_DIR, pattern = "\\.zip$", full.names = TRUE)
for (zf in zip_files) {
  cat("[UNZIP]", basename(zf), "\n")
  unzip(zf, exdir = RAW_DIR, overwrite = TRUE)
}

# --- Report ---
cat("\n=== Download complete ===\n")
cat("Files in", RAW_DIR, ":\n")
files <- list.files(RAW_DIR, recursive = FALSE)
for (f in files) {
  size_mb <- file.size(file.path(RAW_DIR, f)) / 1024^2
  cat("  ", f, "-", round(size_mb, 1), "MB\n")
}
