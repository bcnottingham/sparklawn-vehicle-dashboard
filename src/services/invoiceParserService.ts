import fs from 'fs';
const pdfParse = require('pdf-parse');

export interface ParsedInvoiceData {
  contractor: string;
  invoiceNumber: string;
  invoiceDate: Date;
  propertyName?: string;
  propertyAddress?: string;
  serviceCode?: string;
  serviceDescription?: string;
  tripNumber?: string;
  amount: number;
  notes?: string;
}

/**
 * Main invoice parser that routes to the appropriate contractor-specific parser
 */
export class InvoiceParserService {

  /**
   * Parse a PDF invoice and extract structured data
   * @param pdfPath - Path to the PDF file
   * @param contractorHint - Optional hint about which contractor this is from
   */
  async parsePDF(pdfPath: string, contractorHint?: string): Promise<ParsedInvoiceData> {
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await pdfParse(dataBuffer);
    const text = pdfData.text;

    // Determine which contractor based on content or hint
    if (contractorHint?.toLowerCase().includes('travis') || text.includes("TRAVIS' GREEN LAWNS")) {
      return this.parseTravisGreenLawns(text);
    } else if (contractorHint?.toLowerCase().includes('irrigation') || text.includes('Irrigation Solutions Inc')) {
      return this.parseIrrigationSolutions(text);
    } else if (contractorHint?.toLowerCase().includes('sod') || text.includes('Sod Partners') || text.includes('The Sod Store')) {
      return this.parseSodPartners(text);
    } else if (contractorHint?.toLowerCase().includes('titan') || text.includes('Titan Lawn')) {
      return this.parseTitanLawn(text);
    } else {
      throw new Error('Unable to determine contractor type from PDF');
    }
  }

  /**
   * Parse invoice from Travis' Green Lawns
   * Format: QuickBooks invoice with "Sparklawn XX" property names and "Trip #X" service details
   */
  private parseTravisGreenLawns(text: string): ParsedInvoiceData {
    const lines = text.split('\n').map(l => l.trim());

    // Extract invoice number
    const invoiceNumMatch = text.match(/Invoice\s*#?\s*(\d+)/i);
    const invoiceNumber = invoiceNumMatch ? invoiceNumMatch[1] : '';

    // Extract date (format: 09/24/2025)
    const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const invoiceDate = dateMatch
      ? new Date(`${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}`)
      : new Date();

    // Extract property name (e.g., "Sparklawn 41")
    const propertyMatch = text.match(/Sparklawn\s+(\d+)/i);
    const propertyName = propertyMatch ? `Sparklawn ${propertyMatch[1]}` : '';

    // Extract address
    const addressMatch = text.match(/(\d+\s+[A-Za-z\s]+(?:Dr|St|Ave|Rd|Ln|Cir|Ct|Blvd|Way|Pl)[.,\s]+[A-Za-z\s]+,\s*AR)/i);
    const propertyAddress = addressMatch ? addressMatch[1] : '';

    // Extract service code (e.g., T62010F)
    const serviceCodeMatch = text.match(/([A-Z]\d{5}[A-Z])/);
    const serviceCode = serviceCodeMatch ? serviceCodeMatch[1] : '';

    // Extract trip number and service description
    const tripMatch = text.match(/Trip\s*#?(\d+)[:\s]+([^\n]+)/i);
    const tripNumber = tripMatch ? tripMatch[1] : '';
    let serviceDescription = tripMatch ? tripMatch[2].trim() : '';

    // Fallback: If no "Trip #" pattern, look for ACTIVITY/DESCRIPTION table format
    if (!serviceDescription) {
      // Look for pattern: ACTIVITY DESCRIPTION QTY RATE AMOUNT
      // Then capture the activity and description on the next line
      const activityMatch = text.match(/ACTIVITY\s+DESCRIPTION[\s\S]*?([^\n]+?)\s+([^\n]+?)\s+\d+\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}/i);
      if (activityMatch) {
        // Combine activity name and description
        const activity = activityMatch[1].trim();
        const description = activityMatch[2].trim();
        serviceDescription = `${activity} - ${description}`;
      } else {
        // Another fallback: look for any line with "Aeration" or other common services
        const commonServiceMatch = text.match(/(Aeration[^\n]*|Fertiliz[^\n]*|Weed Control[^\n]*|Mowing[^\n]*|Treatment[^\n]*)/i);
        if (commonServiceMatch) {
          serviceDescription = commonServiceMatch[1].trim().substring(0, 200);
        }
      }
    }

    // Extract amount (look for BALANCE DUE or Total)
    const amountMatch = text.match(/(?:BALANCE DUE|Total|Amount Due)[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    return {
      contractor: "Travis' Green Lawns",
      invoiceNumber,
      invoiceDate,
      propertyName,
      propertyAddress,
      serviceCode,
      serviceDescription,
      tripNumber,
      amount
    };
  }

  /**
   * Parse invoice from Irrigation Solutions Inc
   * Format: Variable services, address often in NOTES section
   */
  private parseIrrigationSolutions(text: string): ParsedInvoiceData {
    const lines = text.split('\n').map(l => l.trim());

    // Extract invoice number
    const invoiceNumMatch = text.match(/Invoice\s*#?\s*(\d+)/i);
    const invoiceNumber = invoiceNumMatch ? invoiceNumMatch[1] : '';

    // Extract date - handle both M/D/YYYY and MM/DD/YYYY formats
    // First try to find "Date" label followed by date (more specific for Irrigation invoices)
    let dateMatch = text.match(/Date[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);

    // If not found, try general date pattern anywhere in text
    if (!dateMatch) {
      dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    }

    const invoiceDate = dateMatch
      ? new Date(`${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`)
      : new Date();

    // Extract service description from Description column
    let serviceDescription = 'Irrigation Services'; // Default value

    // Look for labor/work descriptions (e.g., "Labor to repair and maintain existing irrigation system")
    const laborMatch = text.match(/Labor\s+to\s+([^\n]+?)(?:\n|\r|$)/i);
    if (laborMatch) {
      serviceDescription = 'Labor to ' + laborMatch[1].trim();
    } else {
      // Try general description pattern
      const serviceLineMatch = text.match(/(?:Description|Service)[:\s]+([^\n]+)/i);
      if (serviceLineMatch) {
        serviceDescription = serviceLineMatch[1].trim();
      } else {
        // Look for common patterns in line items
        const itemMatch = text.match(/(?:Item|Activity|Work)[:\s]*([^\n]+)/i);
        if (itemMatch) {
          serviceDescription = itemMatch[1].trim();
        }
      }
    }

    // Clean up service description (remove extra whitespace, limit length)
    if (serviceDescription && serviceDescription !== 'Irrigation Services') {
      serviceDescription = serviceDescription
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200); // Limit to 200 chars
    }

    // Look for address - can be in NOTES section or Description section
    let propertyAddress = '';
    let notes = '';

    // First, try to find address anywhere in the text (including Description column)
    // Pattern matches addresses like "901 Jones Road" or "21 S Mission Hills"
    const addressPattern = /(\d+\s+[NSEW]?\s*[A-Za-z\s]+(?:Road|Dr|Drive|St|Street|Ave|Avenue|Rd|Ln|Lane|Cir|Circle|Ct|Court|Blvd|Boulevard|Way|Pl|Place|Hills|Parkway|Pkwy))/i;
    const addressMatch = text.match(addressPattern);
    if (addressMatch) {
      propertyAddress = addressMatch[1].trim();
    }

    // Also check for city/state pattern to get full address
    // Pattern: "Springdale, AR" or "Fayetteville, AR 72701"
    if (propertyAddress) {
      const cityStatePattern = new RegExp(propertyAddress + '[\\s,]*([A-Za-z\\s]+,\\s*AR[\\s.]*\\d{5})', 'i');
      const cityStateMatch = text.match(cityStatePattern);
      if (cityStateMatch) {
        propertyAddress = cityStateMatch[0].trim();
      }
    }

    // Look for notes section
    const notesMatch = text.match(/NOTES?[:\s]+([^\n]+)/i);
    if (notesMatch) {
      notes = notesMatch[1].trim();
    }

    // Extract amount - handle multi-line format where label and value are on different lines
    let amount = 0;

    // Try direct match first (label and amount on same line)
    let amountMatch = text.match(/(?:BALANCE DUE|Total|Amount Due)[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    } else {
      // Try multi-line match - look for "Balance Due" then find the next dollar amount
      const balanceDueIndex = text.search(/Balance Due/i);
      if (balanceDueIndex >= 0) {
        const afterBalanceDue = text.substring(balanceDueIndex);
        const dollarMatch = afterBalanceDue.match(/\$\s*([\d,]+\.\d{2})/);
        if (dollarMatch) {
          amount = parseFloat(dollarMatch[1].replace(/,/g, ''));
        }
      }
    }

    // Ensure serviceDescription is never empty
    if (!serviceDescription || serviceDescription.trim() === '') {
      serviceDescription = 'Irrigation Services';
    }

    return {
      contractor: 'Irrigation Solutions Inc',
      invoiceNumber,
      invoiceDate,
      propertyAddress,
      serviceDescription,
      amount,
      notes
    };
  }

  /**
   * Parse invoice from Sod Partners LLC / The Sod Store
   * Format: QuickBooks invoices
   */
  private parseSodPartners(text: string): ParsedInvoiceData {
    // Extract invoice number
    const invoiceNumMatch = text.match(/Invoice\s*#?\s*(\w+)/i);
    const invoiceNumber = invoiceNumMatch ? invoiceNumMatch[1] : '';

    // Extract date
    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const invoiceDate = dateMatch
      ? new Date(`${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`)
      : new Date();

    // Service description - look for common sod/landscaping terms
    let serviceDescription = 'Sod & Landscaping Services';
    const serviceMatch = text.match(/(?:Description|Service|Item)[:\s]+([^\n]+)/i);
    if (serviceMatch) {
      serviceDescription = serviceMatch[1].trim().substring(0, 200);
    }

    // Extract amount
    const amountMatch = text.match(/(?:BALANCE DUE|Total|Amount Due)[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    return {
      contractor: 'Sod Partners LLC',
      invoiceNumber,
      invoiceDate,
      serviceDescription,
      amount
    };
  }

  /**
   * Parse invoice from Titan Lawn & Landscape
   * Format: QuickBooks invoices
   */
  private parseTitanLawn(text: string): ParsedInvoiceData {
    // Extract invoice number
    const invoiceNumMatch = text.match(/Invoice\s*#?\s*(\w+)/i);
    const invoiceNumber = invoiceNumMatch ? invoiceNumMatch[1] : '';

    // Extract date
    const dateMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const invoiceDate = dateMatch
      ? new Date(`${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}`)
      : new Date();

    // Service description
    let serviceDescription = 'Lawn & Landscape Services';
    const serviceMatch = text.match(/(?:Description|Service|Item)[:\s]+([^\n]+)/i);
    if (serviceMatch) {
      serviceDescription = serviceMatch[1].trim().substring(0, 200);
    }

    // Extract amount
    const amountMatch = text.match(/(?:BALANCE DUE|Total|Amount Due)[:\s]*\$?\s*([\d,]+\.\d{2})/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;

    return {
      contractor: 'Titan Lawn & Landscape',
      invoiceNumber,
      invoiceDate,
      serviceDescription,
      amount
    };
  }

  /**
   * Extract text from PDF without parsing (for debugging)
   */
  async extractRawText(pdfPath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfData = await (pdfParse as any)(dataBuffer);
    return pdfData.text;
  }
}

export default new InvoiceParserService();
