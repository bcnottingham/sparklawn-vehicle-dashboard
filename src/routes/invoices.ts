import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Invoice from '../db/invoiceSchema';
import Payment from '../db/paymentSchema';
import invoiceParserService from '../services/invoiceParserService';
import propertyMatchingService from '../services/propertyMatchingService';
import gmailInvoiceExtractor from '../services/gmailInvoiceExtractor';
import gmailService from '../services/gmailService';

const router = express.Router();

// Configure multer for PDF uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/invoices');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `invoice-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

/**
 * POST /api/invoices/upload
 * Upload and parse an invoice PDF
 */
router.post('/upload', upload.single('invoice'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const contractorHint = req.body.contractor;
    const filePath = req.file.path;

    // Parse the PDF
    const parsedData = await invoiceParserService.parsePDF(filePath, contractorHint);

    // Try to match property to client database
    const propertyMatch = await propertyMatchingService.matchProperty(
      parsedData.propertyAddress,
      parsedData.propertyName
    );

    // Create invoice record
    const invoice = new Invoice({
      contractor: parsedData.contractor,
      invoiceNumber: parsedData.invoiceNumber,
      invoiceDate: parsedData.invoiceDate,
      propertyName: parsedData.propertyName,
      propertyAddress: parsedData.propertyAddress,
      matchedClientName: propertyMatch.matched ? propertyMatch.clientName : undefined,
      serviceCode: parsedData.serviceCode,
      serviceDescription: parsedData.serviceDescription,
      tripNumber: parsedData.tripNumber,
      amount: parsedData.amount,
      status: 'pending',
      pdfUrl: `/uploads/invoices/${req.file.filename}`,
      notes: parsedData.notes
    });

    await invoice.save();

    res.json({
      success: true,
      invoice: invoice.toObject(),
      propertyMatch: {
        matched: propertyMatch.matched,
        confidence: propertyMatch.confidence
      }
    });

  } catch (error: any) {
    console.error('Error processing invoice upload:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices
 * Get all invoices with optional filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, contractor, startDate, endDate, limit = 1000 } = req.query;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (contractor) {
      query.contractor = new RegExp(contractor as string, 'i');
    }

    if (startDate || endDate) {
      query.invoiceDate = {};
      if (startDate) {
        query.invoiceDate.$gte = new Date(startDate as string);
      }
      if (endDate) {
        query.invoiceDate.$lte = new Date(endDate as string);
      }
    }

    const invoices = await Invoice.find(query)
      .sort({ invoiceDate: -1 })
      .limit(Number(limit))
      .maxTimeMS(5000)
      .exec();

    res.json({
      success: true,
      count: invoices.length,
      invoices
    });

  } catch (error: any) {
    console.error('Error fetching invoices:', error);
    // Return empty array if buffering timeout (collection doesn't exist yet)
    if (error.message?.includes('buffering timed out')) {
      return res.json({ success: true, count: 0, invoices: [] });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/stats
 * Get invoice statistics and running totals
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    const matchStage: any = {};
    if (startDate || endDate) {
      matchStage.invoiceDate = {};
      if (startDate) matchStage.invoiceDate.$gte = new Date(startDate as string);
      if (endDate) matchStage.invoiceDate.$lte = new Date(endDate as string);
    }

    // Aggregate totals by contractor
    const byContractor = await Invoice.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: '$contractor',
          totalPending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
          },
          totalPaid: {
            $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { totalPending: -1 } }
    ]);

    // Aggregate totals by month
    const byMonth = await Invoice.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: {
            year: { $year: '$invoiceDate' },
            month: { $month: '$invoiceDate' }
          },
          totalAmount: { $sum: '$amount' },
          pendingAmount: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
          },
          paidAmount: {
            $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } }
    ]);

    // Overall totals
    const overall = await Invoice.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: null,
          totalPending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] }
          },
          totalPaid: {
            $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] }
          },
          totalInvoices: { $sum: 1 }
        }
      }
    ]);

    // Format byMonth to include readable month names
    const formattedByMonth = byMonth.map((m: any) => ({
      month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
      totalAmount: m.totalAmount,
      pendingAmount: m.pendingAmount,
      paidAmount: m.paidAmount,
      count: m.count
    }));

    // Format byContractor
    const formattedByContractor = byContractor.map((c: any) => ({
      contractor: c._id,
      totalAmount: c.totalPending + c.totalPaid,
      totalPending: c.totalPending,
      totalPaid: c.totalPaid,
      count: c.count
    }));

    // Format byStatus
    const byStatus = [
      { status: 'pending', totalAmount: overall[0]?.totalPending || 0 },
      { status: 'paid', totalAmount: overall[0]?.totalPaid || 0 }
    ];

    res.json({
      success: true,
      stats: {
        overall: overall[0] || { totalPending: 0, totalPaid: 0, totalInvoices: 0 },
        byContractor: formattedByContractor,
        byMonth: formattedByMonth,
        byStatus
      }
    });

  } catch (error: any) {
    console.error('Error fetching invoice stats:', error);
    // Return empty stats if buffering timeout (collection doesn't exist yet)
    if (error.message?.includes('buffering timed out')) {
      return res.json({
        success: true,
        stats: {
          overall: { totalPending: 0, totalPaid: 0, totalInvoices: 0 },
          byContractor: [],
          byMonth: [],
          byStatus: []
        }
      });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/invoices/:id/status
 * Update invoice status (e.g., mark as paid)
 */
router.patch('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, paidDate } = req.body;

    if (!['pending', 'paid', 'overdue'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const updateData: any = { status };
    if (status === 'paid' && paidDate) {
      updateData.paidDate = new Date(paidDate);
    }

    const invoice = await Invoice.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ success: true, invoice });

  } catch (error: any) {
    console.error('Error updating invoice status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/invoices/batch-pay
 * Mark multiple invoices as paid (for monthly payments)
 */
router.post('/batch-pay', async (req: Request, res: Response) => {
  try {
    const { invoiceIds, paidDate, paymentReceiptUrl } = req.body;

    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'No invoice IDs provided' });
    }

    const result = await Invoice.updateMany(
      { _id: { $in: invoiceIds } },
      {
        $set: {
          status: 'paid',
          paidDate: paidDate ? new Date(paidDate) : new Date(),
          paymentReceiptUrl: paymentReceiptUrl || undefined
        }
      }
    );

    res.json({
      success: true,
      updated: result.modifiedCount
    });

  } catch (error: any) {
    console.error('Error batch updating invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/payments
 * Get all payments with optional filtering
 */
router.get('/payments', async (req: Request, res: Response) => {
  try {
    const { contractor, startDate, endDate } = req.query;
    const query: any = {};

    if (contractor) {
      query.contractor = new RegExp(contractor as string, 'i');
    }

    if (startDate || endDate) {
      query.paymentDate = {};
      if (startDate) {
        query.paymentDate.$gte = new Date(startDate as string);
      }
      if (endDate) {
        query.paymentDate.$lte = new Date(endDate as string);
      }
    }

    const payments = await Payment.find(query)
      .sort({ paymentDate: -1 })
      .maxTimeMS(5000)
      .exec();

    res.json({
      success: true,
      count: payments.length,
      payments
    });
  } catch (error: any) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/balance
 * Get net balance (invoices - payments) by contractor
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    // Get invoice totals by contractor
    const invoiceTotals = await Invoice.aggregate([
      {
        $group: {
          _id: '$contractor',
          totalInvoiced: { $sum: '$amount' },
          totalPending: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0]
            }
          },
          invoiceCount: { $sum: 1 }
        }
      }
    ]).option({ maxTimeMS: 5000 });

    // Get payment totals by contractor
    const paymentTotals = await Payment.aggregate([
      {
        $group: {
          _id: '$contractor',
          totalPaid: { $sum: '$amount' },
          paymentCount: { $sum: 1 }
        }
      }
    ]).option({ maxTimeMS: 5000 });

    // Combine data
    const balanceByContractor = invoiceTotals.map((inv: any) => {
      const payment = paymentTotals.find((p: any) => p._id === inv._id);
      const totalPaid = payment ? payment.totalPaid : 0;
      const paymentCount = payment ? payment.paymentCount : 0;

      return {
        contractor: inv._id,
        totalInvoiced: inv.totalInvoiced,
        totalPaid: totalPaid,
        netBalance: inv.totalInvoiced - totalPaid,
        pendingInvoices: inv.totalPending,
        invoiceCount: inv.invoiceCount,
        paymentCount: paymentCount
      };
    });

    res.json({
      success: true,
      balances: balanceByContractor
    });
  } catch (error: any) {
    console.error('Error calculating balance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/:id
 * Get single invoice by ID
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.findById(req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ success: true, invoice });

  } catch (error: any) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/invoices/:id
 * Delete an invoice
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const invoice = await Invoice.findByIdAndDelete(req.params.id);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Optionally delete the PDF file
    if (invoice.pdfUrl) {
      const filePath = path.join(__dirname, '../../', String(invoice.pdfUrl));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    res.json({ success: true, message: 'Invoice deleted' });

  } catch (error: any) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/gmail/auth-url
 * Get Gmail authorization URL
 */
router.get('/gmail/auth-url', (req: Request, res: Response) => {
  try {
    const authUrl = gmailService.getAuthUrl();
    res.json({ success: true, authUrl });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/invoices/gmail/status
 * Check Gmail authorization status
 */
router.get('/gmail/status', (req: Request, res: Response) => {
  const isAuthorized = gmailService.isAuthorized();
  const tokenInfo = gmailService.getTokenInfo();

  res.json({
    success: true,
    authorized: isAuthorized,
    tokenInfo: tokenInfo ? {
      hasRefreshToken: !!tokenInfo.refresh_token,
      expiryDate: tokenInfo.expiry_date
    } : null
  });
});

/**
 * POST /api/invoices/gmail/extract
 * Extract all invoices from Gmail
 */
router.post('/gmail/extract', async (req: Request, res: Response) => {
  try {
    if (!gmailService.isAuthorized()) {
      return res.status(401).json({
        error: 'Gmail not authorized',
        message: 'Please authorize Gmail access first'
      });
    }

    const { startDate, endDate } = req.body;

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    console.log('\n📧 Starting Gmail invoice extraction...');
    const invoiceResults = await gmailInvoiceExtractor.extractAllInvoices(start, end);

    console.log('\n💰 Starting Gmail payment receipt extraction...');
    const paymentResults = await gmailInvoiceExtractor.extractPaymentReceipts(start, end);

    const stats = await gmailInvoiceExtractor.getExtractionStats();

    res.json({
      success: true,
      invoicesExtracted: invoiceResults.length,
      paymentsExtracted: paymentResults.length,
      stats
    });

  } catch (error: any) {
    console.error('Error extracting invoices from Gmail:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/invoices/payments
 * Record a payment made to a contractor
 */
router.post('/payments', async (req: Request, res: Response) => {
  try {
    const { contractor, paymentDate, amount, paymentMethod, checkNumber, confirmationNumber, notes, invoiceIds } = req.body;

    if (!contractor || !paymentDate || !amount) {
      return res.status(400).json({ error: 'Contractor, payment date, and amount are required' });
    }

    const payment = new Payment({
      contractor,
      paymentDate: new Date(paymentDate),
      amount: parseFloat(amount),
      paymentMethod,
      checkNumber,
      confirmationNumber,
      notes,
      invoiceIds: invoiceIds || []
    });

    await payment.save();

    res.json({
      success: true,
      payment
    });
  } catch (error: any) {
    console.error('Error recording payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/invoices/payments/:id
 * Delete a payment record
 */
router.delete('/payments/:id', async (req: Request, res: Response) => {
  try {
    const payment = await Payment.findByIdAndDelete(req.params.id);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({
      success: true,
      message: 'Payment deleted successfully',
      payment
    });
  } catch (error: any) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/invoices/reparse-irrigation
 * Re-parse all Irrigation Solutions invoices to fix dates
 */
router.post('/reparse-irrigation', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Re-parsing all Irrigation Solutions invoices...');

    const invoices = await Invoice.find({ contractor: 'Irrigation Solutions Inc' });
    console.log(`   Found ${invoices.length} Irrigation invoices to reparse`);

    let updated = 0;
    let errors = 0;

    for (const invoice of invoices) {
      try {
        // Read the PDF from the uploads directory
        const pdfPath = path.join(__dirname, '../..', invoice.pdfUrl as string);

        if (!fs.existsSync(pdfPath)) {
          console.log(`   ⚠️  PDF not found: ${pdfPath}`);
          continue;
        }

        // Re-parse the PDF
        const parsedData = await invoiceParserService.parsePDF(pdfPath, 'Irrigation Solutions Inc');

        // Update only the invoiceDate field
        invoice.invoiceDate = parsedData.invoiceDate;
        await invoice.save();

        console.log(`   ✅ Updated invoice ${invoice.invoiceNumber}: ${parsedData.invoiceDate}`);
        updated++;
      } catch (error: any) {
        console.error(`   ❌ Error reparsing invoice ${invoice.invoiceNumber}:`, error.message);
        errors++;
      }
    }

    res.json({
      success: true,
      message: `Reparsed ${updated} invoices (${errors} errors)`,
      updated,
      errors
    });
  } catch (error: any) {
    console.error('Error reparsing invoices:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/invoices/reparse-payments
 * Re-parse all payment receipts to fix amounts
 */
router.post('/reparse-payments', async (req: Request, res: Response) => {
  try {
    console.log('🔄 Re-parsing all payment receipts...');

    const payments = await Payment.find({});
    console.log(`   Found ${payments.length} payment receipts to reparse`);

    let updated = 0;
    let errors = 0;

    for (const payment of payments) {
      try {
        // Read the PDF from the uploads directory
        const pdfPath = path.join(__dirname, '../..', payment.receiptUrl as string);

        if (!fs.existsSync(pdfPath)) {
          console.log(`   ⚠️  PDF not found: ${pdfPath}`);
          continue;
        }

        // Parse the PDF
        const pdfParse = require('pdf-parse');
        const data = fs.readFileSync(pdfPath);
        const pdfData = await pdfParse(data);
        const text = pdfData.text;

        // Extract payment amount - look for the payment line in table format
        // Example: "1 47935 09/01/2025 7191.76" where last number is payment
        let amount = 0;

        // Try to find payment in table format (Invoice Number | Invoice Date | Payment)
        const tableMatch = text.match(/(\d+)\s+(\d{5})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d,]+\.?\d*)/);
        if (tableMatch && tableMatch[4]) {
          amount = parseFloat(tableMatch[4].replace(/,/g, ''));
        }

        // Fallback: look for explicit amount patterns
        if (amount === 0) {
          const amountMatch = text.match(/(?:Amount|Total|Payment)[\s:]*\$?([\d,]+\.?\d*)/i);
          amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
        }

        if (amount === 0 || amount === payment.amount) {
          console.log(`   ⏭️  Skipping payment ${payment._id} (amount unchanged or invalid)`);
          continue;
        }

        // Update the payment amount
        payment.amount = amount;
        await payment.save();

        console.log(`   ✅ Updated payment ${payment._id}: $${payment.amount} → $${amount}`);
        updated++;

      } catch (error: any) {
        console.error(`   ❌ Error processing payment ${payment._id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n✅ Re-parsing complete!`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);

    res.json({
      success: true,
      updated,
      errors,
      total: payments.length
    });
  } catch (error: any) {
    console.error('Error re-parsing payments:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
