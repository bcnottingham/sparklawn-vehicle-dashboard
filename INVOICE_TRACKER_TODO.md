# Invoice Tracker - Issues to Fix

## Current Status (Oct 4, 2025)

✅ **Server is running** - http://localhost:3002/invoices
✅ **Travis' Green Lawns extraction working** - 275 invoices, $50,344 pending
❌ **Irrigation Solutions invoices missing** - Need to re-extract
❌ **UI shows separate contractor sections** - Need unified feed

---

## Issues to Fix

### 1. **Irrigation Solutions Invoices Missing**
- Database only has Travis' Green Lawns (275 invoices)
- Need to re-extract from Gmail
- Possible causes:
  - Email pattern not matching correctly
  - PDF parsing failing
  - Invoices were deleted/cleared at some point

**Action**: Click "Extract All Invoices from Gmail" and check server logs for Irrigation Solutions

---

### 2. **Unified Invoice Feed (Priority)**
**Current**: Separate sections/tabs for each contractor
**Wanted**: Single unified feed with inline contractor labels

**Changes needed**:
- Remove contractor-separated sections
- Add "Contractor" column to the main invoice table
- Show all invoices together, sortable/filterable by contractor
- Keep contractor badge/label inline with each row

---

### 3. **Gmail Extraction Error (FIXED)**
~~"Extraction failed: Failed to fetch"~~
- Was caused by server not running
- Server now running successfully

---

## Quick Wins for Next Session

1. **Re-run Gmail extraction** - Should pull in Irrigation Solutions invoices
2. **Update UI layout** - One unified invoice table with contractor column
3. **Add filtering** - Quick filter buttons: "All" | "Travis" | "Irrigation"
4. **Check property matching** - Only 1/275 Travis invoices matched to clients (Grant Davidson)

---

## Property Matching Issues

From screenshot: Most invoices show "No match" in CLIENT MATCH column
- Travis uses "Sparklawn 7", "Sparklawn 32", etc.
- Need mapping table: "Sparklawn 41" → "Grant Davidson" (this one worked!)
- Could build a manual mapping UI or improve address matching logic

---

## Notes

- Invoice data is stored in MongoDB `invoices` collection
- PDFs stored in `/uploads/invoices/`
- Gmail OAuth is working (shows "✅ Connected")
- Total pending: $50,344.00 (all Travis' Green Lawns)
- Need to verify Irrigation Solutions email patterns in `gmailInvoiceExtractor.ts`

---

## Files to Check Next Session

- `/src/services/gmailInvoiceExtractor.ts` - Email extraction patterns
- `/src/views/invoices.html` - UI layout (needs unified feed)
- `/src/services/propertyMatchingService.ts` - Client matching logic
- Check server logs when re-running extraction

---

**Server start command**: `npm start` (already running in background)
**Current PID**: Check with `lsof -ti:3002`
