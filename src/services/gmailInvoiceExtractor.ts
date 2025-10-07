import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { gmailService } from './gmailService';
import invoiceParserService from './invoiceParserService';
import propertyMatchingService from './propertyMatchingService';
import Invoice from '../db/invoiceSchema';
import Payment from '../db/paymentSchema';

interface InvoiceEmailPattern {
  contractor: string;
  fromEmail: string[];
  subjectContains: string[];
  hasAttachment: boolean;
}

export class GmailInvoiceExtractor {
  private patterns: InvoiceEmailPattern[] = [
    {
      contractor: "Travis' Green Lawns",
      fromEmail: ['quickbooks@notification.intuit.com'],
      subjectContains: ['Invoice', 'TRAVIS', 'Green Lawns'],
      hasAttachment: true
    },
    {
      contractor: 'Irrigation Solutions Inc',
      fromEmail: ['billing@irrigationsolutionsinc.com', 'brenda@irrigationsolutionsinc.com'],
      subjectContains: ['Invoice'],
      hasAttachment: true
    },
    {
      contractor: 'Sod Partners LLC',
      fromEmail: ['quickbooks@notification.intuit.com'],
      subjectContains: ['Invoice', 'Sod Partners', 'The Sod Store'],
      hasAttachment: true
    },
    {
      contractor: 'Titan Lawn & Landscape',
      fromEmail: ['quickbooks@notification.intuit.com'],
      subjectContains: ['Invoice', 'Titan Lawn', 'Titan Landscaping'],
      hasAttachment: true
    }
  ];

  private paymentReceiptPatterns: InvoiceEmailPattern[] = [
    {
      contractor: "Travis' Green Lawns",
      fromEmail: ['quickbooks@notification.intuit.com'],
      subjectContains: ['Payment Receipt', 'TRAVIS'],
      hasAttachment: false  // Can parse both PDF and HTML emails
    },
    {
      contractor: 'Irrigation Solutions Inc',
      fromEmail: [
        'billing@irrigationsolutionsinc.com',
        'brenda@irrigationsolutionsinc.com',
        'quickbooks@notification.intuit.com'
      ],
      subjectContains: ['Payment Receipt', 'Payment Received', 'Payment confirmation', 'IRRIGATION SOLUTIONS'],
      hasAttachment: false  // Can parse both PDF and HTML emails
    }
  ];

  /**
   * Extract all invoices from Gmail inbox
   */
  async extractAllInvoices(startDate?: Date, endDate?: Date): Promise<any[]> {
    console.log('📧 Starting Gmail invoice extraction...');
    console.log(`📋 Total patterns configured: ${this.patterns.length}`);

    const results = [];

    for (let i = 0; i < this.patterns.length; i++) {
      const pattern = this.patterns[i];
      console.log(`\n🔍 [${i + 1}/${this.patterns.length}] Searching for ${pattern.contractor} invoices...`);

      try {
        const emails = await this.searchInvoiceEmails(pattern, startDate, endDate);
        console.log(`   Found ${emails.length} potential invoice emails`);

        for (const email of emails) {
          try {
            const result = await this.processInvoiceEmail(email, pattern.contractor);
            if (result) {
              results.push(result);
            }
          } catch (error: any) {
            console.error(`   ❌ Error processing email ${email.id}:`, error.message);
          }
        }

        console.log(`   ✓ Completed ${pattern.contractor} extraction`);
      } catch (error: any) {
        console.error(`   ❌ ERROR searching for ${pattern.contractor}:`, error.message);
        console.error(`   Stack:`, error.stack);
      }
    }

    console.log(`\n✅ Invoice extraction complete! Processed ${results.length} invoices`);
    return results;
  }

  /**
   * Search Gmail for invoice emails matching pattern
   */
  private async searchInvoiceEmails(
    pattern: InvoiceEmailPattern,
    startDate?: Date,
    endDate?: Date
  ): Promise<any[]> {
    const gmail = await gmailService.getGmailClient();

    // Build search query
    let query = '';

    // From email addresses
    if (pattern.fromEmail.length > 0) {
      const fromQuery = pattern.fromEmail.map(email => `from:${email}`).join(' OR ');
      query += `(${fromQuery})`;
    }

    // Subject keywords (OR logic - match any of the keywords)
    if (pattern.subjectContains.length > 0) {
      const subjectQuery = pattern.subjectContains.map(word => `subject:"${word}"`).join(' OR ');
      query += ` (${subjectQuery})`;
    }

    // Has attachment (optional - can also parse HTML-only emails)
    if (pattern.hasAttachment) {
      query += ' has:attachment';
      query += ' filename:pdf';
    }

    // Date range
    if (startDate) {
      const dateStr = startDate.toISOString().split('T')[0].replace(/-/g, '/');
      query += ` after:${dateStr}`;
    }

    if (endDate) {
      const dateStr = endDate.toISOString().split('T')[0].replace(/-/g, '/');
      query += ` before:${dateStr}`;
    }

    // Search everywhere including trash, archive, spam
    query += ' in:anywhere';

    console.log(`   Query: ${query}`);

    // Search emails
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500
    });

    const messages = response.data.messages || [];
    return messages;
  }

  /**
   * Process a single invoice email
   */
  private async processInvoiceEmail(
    message: any,
    contractorName: string
  ): Promise<any | null> {
    const gmail = await gmailService.getGmailClient();

    // Get full email details
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'full'
    });

    const emailData = email.data;
    const headers = emailData.payload?.headers || [];

    // Extract email metadata
    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
    const from = headers.find((h: any) => h.name === 'From')?.value || '';
    const date = headers.find((h: any) => h.name === 'Date')?.value || '';

    console.log(`   📧 Processing: ${subject.substring(0, 60)}...`);

    // Find PDF attachments
    const attachments = await this.findPDFAttachments(emailData);

    if (attachments.length === 0) {
      console.log(`      ⚠️ No PDF attachments found`);
      return null;
    }

    // Process each PDF attachment
    for (const attachment of attachments) {
      try {
        // Download attachment
        const pdfPath = await this.downloadAttachment(
          message.id,
          attachment.attachmentId,
          attachment.filename
        );

        console.log(`      📄 Downloaded: ${attachment.filename}`);

        // Check if invoice already exists
        const existingInvoice = await this.checkDuplicateByFilename(attachment.filename);
        if (existingInvoice) {
          console.log(`      ⏭️  Skipping duplicate: ${attachment.filename}`);
          fs.unlinkSync(pdfPath); // Delete downloaded file
          continue;
        }

        // Parse PDF
        const parsedData = await invoiceParserService.parsePDF(pdfPath, contractorName);

        // Check for duplicate by invoice number (with timeout protection)
        let duplicate = null;
        try {
          duplicate = await Invoice.findOne({ invoiceNumber: parsedData.invoiceNumber }).maxTimeMS(5000).exec();
        } catch (error: any) {
          if (error.message?.includes('buffering timed out')) {
            console.log(`      ⚠️  Database timeout checking for duplicates, proceeding with save...`);
          } else {
            throw error;
          }
        }

        if (duplicate) {
          console.log(`      ⏭️  Skipping duplicate invoice #${parsedData.invoiceNumber}`);
          fs.unlinkSync(pdfPath);
          continue;
        }

        // Match property
        const propertyMatch = await propertyMatchingService.matchProperty(
          parsedData.propertyAddress,
          parsedData.propertyName
        );

        // Create invoice record
        const invoice = new Invoice({
          contractor: parsedData.contractor,
          contractorEmail: from,
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
          pdfUrl: `/uploads/invoices/${path.basename(pdfPath)}`,
          emailDate: new Date(date),
          emailSubject: subject,
          notes: parsedData.notes
        });

        try {
          await invoice.save();
          console.log(`      ✅ Saved invoice #${parsedData.invoiceNumber} - $${parsedData.amount}`);
        } catch (saveError: any) {
          // Handle duplicate key error (E11000)
          if (saveError.code === 11000 && saveError.message?.includes('invoiceNumber')) {
            console.log(`      ⏭️  Skipping duplicate invoice #${parsedData.invoiceNumber} (database prevented duplicate)`);
            fs.unlinkSync(pdfPath);
            continue;
          }
          throw saveError;
        }

        return {
          invoice: invoice.toObject(),
          propertyMatch
        };

      } catch (error: any) {
        console.error(`      ❌ Error processing attachment:`, error.message);
        continue;
      }
    }

    return null;
  }

  /**
   * Find PDF attachments in email
   */
  private async findPDFAttachments(emailData: any): Promise<any[]> {
    const attachments: any[] = [];

    const parts = emailData.payload?.parts || [];

    const findAttachments = (parts: any[]) => {
      for (const part of parts) {
        if (part.filename && part.filename.toLowerCase().endsWith('.pdf')) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            attachmentId: part.body?.attachmentId,
            size: part.body?.size
          });
        }

        // Recursive search in nested parts
        if (part.parts) {
          findAttachments(part.parts);
        }
      }
    };

    findAttachments(parts);

    return attachments;
  }

  /**
   * Download attachment from Gmail
   */
  private async downloadAttachment(
    messageId: string,
    attachmentId: string,
    filename: string
  ): Promise<string> {
    const gmail = await gmailService.getGmailClient();

    const attachment = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: attachmentId
    });

    const data = attachment.data.data;
    if (!data) {
      throw new Error('No attachment data received');
    }

    // Decode base64
    const buffer = Buffer.from(data, 'base64');

    // Save to uploads folder
    const uploadDir = path.join(__dirname, '../../uploads/invoices');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const uniqueFilename = `${Date.now()}-${filename}`;
    const filePath = path.join(uploadDir, uniqueFilename);

    fs.writeFileSync(filePath, buffer);

    return filePath;
  }

  /**
   * Check for duplicate by filename (rough check)
   */
  private async checkDuplicateByFilename(filename: string): Promise<boolean> {
    const invoiceNumMatch = filename.match(/(\d{4,})/);
    if (invoiceNumMatch) {
      const invoiceNum = invoiceNumMatch[1];
      try {
        const existing = await Invoice.findOne({ invoiceNumber: invoiceNum }).maxTimeMS(5000).exec();
        return !!existing;
      } catch (error: any) {
        if (error.message?.includes('buffering timed out')) {
          // If timeout, assume no duplicate and let unique index catch it
          return false;
        }
        throw error;
      }
    }
    return false;
  }

  /**
   * Get extraction statistics
   */
  async getExtractionStats(): Promise<any> {
    const totalInvoices = await Invoice.countDocuments();
    const pendingInvoices = await Invoice.countDocuments({ status: 'pending' });
    const paidInvoices = await Invoice.countDocuments({ status: 'paid' });

    const byContractor = await Invoice.aggregate([
      {
        $group: {
          _id: '$contractor',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      }
    ]);

    return {
      total: totalInvoices,
      pending: pendingInvoices,
      paid: paidInvoices,
      byContractor
    };
  }

  /**
   * Extract payment receipts from Gmail
   */
  async extractPaymentReceipts(startDate?: Date, endDate?: Date): Promise<any[]> {
    console.log('💰 Starting Gmail payment receipt extraction...');

    const results = [];

    for (const pattern of this.paymentReceiptPatterns) {
      console.log(`\n🔍 Searching for ${pattern.contractor} payment receipts...`);

      const emails = await this.searchInvoiceEmails(pattern, startDate, endDate);
      console.log(`   Found ${emails.length} potential payment receipt emails`);

      for (const email of emails) {
        try {
          const result = await this.processPaymentReceiptEmail(email, pattern.contractor);
          if (result) {
            results.push(result);
          }
        } catch (error: any) {
          console.error(`   ❌ Error processing payment receipt ${email.id}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Payment receipt extraction complete! Processed ${results.length} receipts`);
    return results;
  }

  /**
   * Process a single payment receipt email
   */
  private async processPaymentReceiptEmail(email: any, contractor: string): Promise<any | null> {
    const gmail = await gmailService.getGmailClient();

    // Get full email details
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: email.id,
      format: 'full'
    });

    const emailData = message.data;
    const headers = emailData.payload?.headers || [];

    const subject = headers.find((h: any) => h.name === 'Subject')?.value || '';
    const emailDate = headers.find((h: any) => h.name === 'Date')?.value || '';

    console.log(`   💰 Processing: ${subject.substring(0, 70)}...`);

    // Verify contractor based on subject line (both come from QuickBooks)
    const subjectUpper = subject.toUpperCase();
    if (contractor === "Travis' Green Lawns" && !subjectUpper.includes('TRAVIS')) {
      console.log(`      ⏭️  Skipping - not for Travis' Green Lawns`);
      return null;
    }
    if (contractor === 'Irrigation Solutions Inc' && !subjectUpper.includes('IRRIGATION')) {
      console.log(`      ⏭️  Skipping - not for Irrigation Solutions`);
      return null;
    }

    // Extract payment amount - try PDF first, then HTML body
    let text = '';
    let pdfPath: string | null = null;
    let uniqueFilename = '';

    // Check for PDF attachment first
    const parts = message.data.payload?.parts || [];
    let hasPdf = false;

    for (const part of parts) {
      if (part.filename && part.filename.toLowerCase().includes('.pdf')) {
        hasPdf = true;
        const attachmentId = part.body?.attachmentId;
        if (!attachmentId) continue;

        // Download attachment
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: email.id,
          id: attachmentId
        });

        const data = Buffer.from(attachment.data.data || '', 'base64');
        const uploadDir = path.join(__dirname, '../../uploads/payments');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const sanitizedFilename = part.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        uniqueFilename = `${Date.now()}-${sanitizedFilename}`;
        pdfPath = path.join(uploadDir, uniqueFilename);

        fs.writeFileSync(pdfPath, data);

        // Parse payment amount from PDF
        const pdfParse = require('pdf-parse');
        const pdfData = await pdfParse(data);
        text = pdfData.text;
        break;
      }
    }

    // If no PDF, extract text from HTML email body
    if (!hasPdf) {
      console.log(`      📧 No PDF attachment - parsing HTML email body`);

      // Get email body (HTML or plain text)
      const getBody = (payload: any): string => {
        if (payload.body?.data) {
          return Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }
        if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/html' || part.mimeType === 'text/plain') {
              if (part.body?.data) {
                return Buffer.from(part.body.data, 'base64').toString('utf-8');
              }
            }
            // Recursive search for multipart emails
            if (part.parts) {
              const result = getBody(part);
              if (result) return result;
            }
          }
        }
        return '';
      };

      text = getBody(emailData.payload);

      if (!text) {
        console.log(`      ⚠️  Could not extract email body text`);
        return null;
      }
    }

    // Extract payment amount - look for the payment line in table format
    // Example: "1 47935 09/01/2025 7191.76" where last number is payment
    // Also handle "BALANCE DUE $0.00" format or standalone amounts
    let amount = 0;

    // Try to find payment in table format (Invoice Number | Invoice Date | Payment)
    const tableMatch = text.match(/(\d+)\s+(\d{5})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+([\d,]+\.?\d*)/);
    if (tableMatch && tableMatch[4]) {
      amount = parseFloat(tableMatch[4].replace(/,/g, ''));
    }

    // Fallback: look for explicit amount patterns in HTML/text
    if (amount === 0) {
      // Try "You paid $5247.00" format (QuickBooks HTML emails)
      const youPaidMatch = text.match(/You paid \$?([\d,]+\.?\d*)/i);
      if (youPaidMatch) {
        amount = parseFloat(youPaidMatch[1].replace(/,/g, ''));
      }
    }

    // Final fallback: generic amount patterns
    if (amount === 0) {
      const amountMatch = text.match(/(?:Total amount|Amount|Total|Payment)[\s:]*\$?([\d,]+\.?\d*)/i);
      amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    }

    if (amount === 0) {
      console.log(`      ⚠️  Could not extract payment amount`);
      if (pdfPath) fs.unlinkSync(pdfPath);
      return null;
    }

    console.log(`      💵 Found payment amount: $${amount.toFixed(2)}`);

    // Check for duplicate by amount and contractor
    const existing = await Payment.findOne({
      contractor: contractor,
      amount: amount,
      paymentDate: new Date(emailDate)
    }).maxTimeMS(5000).exec();

    if (existing) {
      console.log(`      ⏭️  Skipping duplicate payment: $${amount}`);
      if (pdfPath) fs.unlinkSync(pdfPath);
      return null;
    }

    // Create payment record
    const payment = new Payment({
      contractor: contractor,
      paymentDate: new Date(emailDate),
      amount: amount,
      receiptUrl: pdfPath ? `/uploads/payments/${uniqueFilename}` : null,
      notes: `Extracted from Gmail: ${subject}`
    });

    await payment.save();
    console.log(`      ✅ Saved payment receipt - $${amount}`);

    return {
      contractor,
      amount,
      paymentDate: emailDate,
      receiptUrl: pdfPath ? `/uploads/payments/${uniqueFilename}` : null
    };
  }
}

export default new GmailInvoiceExtractor();
