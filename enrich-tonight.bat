@echo off
:: ══════════════════════════════════════════════════════════
:: Catch Comics — Amazon UK Enrichment (Budget-Capped)
:: ══════════════════════════════════════════════════════════
::
:: BEFORE RUNNING:
::   1. Disable Rainforest overage at https://app.rainforestapi.com/
::      Billing → Overage: OFF
::      (Without this, costs can escalate without stopping)
::
:: What it does:
::   Runs batches of 50 ISBNs, max 10 batches, max $10 total.
::   Stops automatically on quota, budget cap, or catalogue exhausted.
::
:: Total exposure: max $10 (≈108 calls at $0.092 overage rate)
::
:: To stop it:
::   Press Ctrl+C once. Finishes the current batch, then exits cleanly.
::
:: Log file:
::   logs\amazon-enrich-YYYY-MM-DD.log
::
title Catch Comics — Amazon Enrichment (Budget-Capped)

cd /d "%~dp0"

echo.
echo  =========================================================
echo   Catch Comics — Amazon UK Enrichment
echo   Budget cap : $10 total
echo   Batch size : 50 ISBNs
echo   Max batches: 10
echo.
echo   IMPORTANT: Ensure Rainforest overage is DISABLED before running.
echo   https://app.rainforestapi.com/ -- Billing -- Overage: OFF
echo  =========================================================
echo.

call npx dotenv -e .env.local -- npx tsx scripts/enrich-overnight.ts --batch 50 --max-batches 10 --budget 10

echo.
echo  Run complete. Check logs\ for details.
echo  Press any key to close.
pause > nul
