# 📋 Subcontractor Invoice Management System

## Overview

A complete invoice tracking system for managing subcontractor invoices from **Travis' Green Lawns** and **Irrigation Solutions Inc**. The system automatically parses PDF invoices, matches properties to your client database, and tracks payment status.

---

## ✨ Features

### 1. **Automated PDF Parsing**
- Upload PDF invoices through web interface
- Automatic contractor detection (Travis' Green Lawns vs Irrigation Solutions)
- Extracts key data:
  - Invoice number
  - Date
  - Property address/name
  - Service description
  - Amount
  - Trip numbers (Travis' Green Lawns)

### 2. **Property Matching**
- Automatically matches invoice addresses to your client database
- Confidence levels: exact, high, medium, low
- Handles address variations

### 3. **Running Totals Dashboard**
- Total pending invoices
- Total paid invoices
- Monthly summaries
- Breakdown by contractor

### 4. **Payment Tracking**
- Mark individual invoices as paid
- Batch payment for monthly invoices
- Payment date tracking
- Receipt upload support

---

## 🚀 How to Use

### Accessing the Dashboard

1. Start your server: `npm start`
2. Navigate to: **http://localhost:3002/invoices**

### Uploading Invoices

1. Click **"📤 Upload New Invoice"**
2. Select PDF file
3. (Optional) Choose contractor or let it auto-detect
4. Click **"Upload & Process"**
5. System will:
   - Parse the PDF
   - Extract invoice data
   - Match property to client database
   - Display confidence level of match

### Managing Invoices

- **View by Contractor**: Invoices grouped by contractor
- **Filter**: By status (pending/paid), contractor, or month
- **Mark as Paid**: Click "Mark Paid" button for individual invoices
- **Delete**: Remove invoices if needed
- **View PDF**: Click invoice number to view original PDF

---

## 📁 File Structure

```
ford-location-dashboard/
├── src/
│   ├── db/
│   │   └── invoiceSchema.ts          # MongoDB schema for invoices
│   ├── services/
│   │   ├── invoiceParserService.ts   # PDF parsing logic
│   │   └── propertyMatchingService.ts # Property matching logic
│   ├── routes/
│   │   └── invoices.ts                # API endpoints
│   └── views/
│       └── invoices.html              # Dashboard UI
├── uploads/
│   └── invoices/                      # Uploaded PDF storage
└── sample-invoices/                   # Place sample PDFs here for testing
```

---

## 🔌 API Endpoints

### Upload Invoice
```http
POST /api/invoices/upload
Content-Type: multipart/form-data

Form Data:
- invoice: PDF file
- contractor: "travis" | "irrigation" (optional)
```

### Get All Invoices
```http
GET /api/invoices?status=pending&contractor=Travis
```

### Get Statistics
```http
GET /api/invoices/stats
```

### Update Invoice Status
```http
PATCH /api/invoices/:id/status
Content-Type: application/json

{
  "status": "paid",
  "paidDate": "2025-10-04"
}
```

### Batch Pay Invoices
```http
POST /api/invoices/batch-pay
Content-Type: application/json

{
  "invoiceIds": ["id1", "id2", "id3"],
  "paidDate": "2025-10-04",
  "paymentReceiptUrl": "/uploads/receipts/receipt.pdf"
}
```

### Delete Invoice
```http
DELETE /api/invoices/:id
```

---

## 🎯 Contractor-Specific Parsing

### Travis' Green Lawns
- **Format**: QuickBooks invoices via email
- **Email From**: quickbooks@notification.intuit.com
- **Key Fields Extracted**:
  - Property name: "Sparklawn 41" format
  - Service code: e.g., "T62010F"
  - Trip number: "Trip #6"
  - Address: Full property address

### Irrigation Solutions Inc
- **Format**: Custom invoices via email
- **Email From**: billing@irrigationsolutionsinc.com
- **Key Fields Extracted**:
  - Address often in NOTES section
  - Variable service descriptions
  - Project-based invoicing

---

## 📊 Database Schema

```typescript
interface IInvoice {
  contractor: string;              // "Travis' Green Lawns" or "Irrigation Solutions Inc"
  contractorEmail?: string;
  invoiceNumber: string;           // Unique invoice number
  invoiceDate: Date;
  dueDate?: Date;
  propertyName?: string;           // e.g., "Sparklawn 41"
  propertyAddress?: string;        // Full address
  matchedClientId?: string;        // Matched client from your database
  matchedClientName?: string;      // Matched client name
  serviceCode?: string;            // e.g., "T62010F"
  serviceDescription: string;      // Service details
  tripNumber?: string;             // e.g., "6" from "Trip #6"
  amount: number;                  // Invoice amount
  status: 'pending' | 'paid' | 'overdue';
  paidDate?: Date;
  paymentReceiptUrl?: string;
  pdfUrl?: string;                 // Link to uploaded PDF
  emailDate?: Date;
  emailSubject?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## 🧪 Testing with Sample PDFs

### Manual Testing

1. Place sample PDFs in `sample-invoices/` folder
2. Navigate to http://localhost:3002/invoices
3. Upload each PDF
4. Verify:
   - ✅ Correct contractor detected
   - ✅ Invoice data extracted accurately
   - ✅ Property matched (if address is in client database)
   - ✅ Running totals update correctly

### Programmatic Testing

Create a test script:

```javascript
const invoiceParser = require('./dist/services/invoiceParserService');

(async () => {
  const result = await invoiceParser.default.parsePDF(
    './sample-invoices/travis-invoice.pdf',
    'travis'
  );
  console.log(result);
})();
```

---

## 🔮 Future Enhancements

### Phase 2: Email Integration
- Monitor Gmail inbox for new invoices
- Auto-download and process invoice PDFs
- Email notifications when new invoices arrive
- Match receipts to close out invoices

### Phase 3: Property Name Mapping
- Create mapping table for contractor internal names
- Example: "Sparklawn 41" → "Nate Green, 21 S Mission Hills"
- Manual mapping interface for unmatched properties

### Phase 4: Accounting Integration
- Export to QuickBooks/Xero
- Generate payment reports
- Tax documentation

---

## 🐛 Troubleshooting

### PDF Not Parsing Correctly

1. Check if PDF is text-based (not scanned image)
2. View raw text extraction:
   ```javascript
   const text = await invoiceParser.extractRawText('path/to/invoice.pdf');
   console.log(text);
   ```
3. Adjust regex patterns in `invoiceParserService.ts` if needed

### Property Not Matching

1. Check client coordinates cache exists:
   ```
   ../sparklawn-website-manager/client-coordinates-cache.json
   ```
2. Review address format in PDF vs. client database
3. Use manual property mapping (future feature)

### Upload Fails

1. Check file size (max 10MB)
2. Ensure `uploads/invoices/` directory exists and is writable
3. Check server logs for detailed error

---

## 📞 Support

For issues or questions:
1. Check server logs: `logs/` directory
2. Review `CONTEXT_FOR_CLAUDE.md` for system architecture
3. Open issue in project repository

---

## ✅ System Status

- ✅ PDF parsing service (Travis' Green Lawns)
- ✅ PDF parsing service (Irrigation Solutions)
- ✅ Property matching service
- ✅ MongoDB database schema
- ✅ API endpoints (upload, list, stats, update, delete)
- ✅ Dashboard UI with running totals
- ✅ TypeScript compilation successful
- ⏳ Email automation (Phase 2)
- ⏳ Property name mapping (Phase 3)

---

**Built with:** Node.js, Express, MongoDB, TypeScript, pdf-parse

**Ready to use:** ✅ System is fully operational!
