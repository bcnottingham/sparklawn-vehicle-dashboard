import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
  contractor: string;
  contractorEmail?: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate?: Date;
  propertyName?: string;
  propertyAddress?: string;
  matchedClientId?: string;
  matchedClientName?: string;
  serviceCode?: string;
  serviceDescription?: string;
  tripNumber?: string;
  amount: number;
  status: 'pending' | 'paid' | 'overdue';
  paidDate?: Date;
  paymentReceiptUrl?: string;
  pdfUrl?: string;
  emailDate?: Date;
  emailSubject?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema: Schema = new Schema(
  {
    contractor: { type: String, required: true, index: true },
    contractorEmail: { type: String },
    invoiceNumber: { type: String, required: true, unique: true },
    invoiceDate: { type: Date, required: true },
    dueDate: { type: Date },
    propertyName: { type: String },
    propertyAddress: { type: String },
    matchedClientId: { type: String, index: true },
    matchedClientName: { type: String },
    serviceCode: { type: String },
    serviceDescription: { type: String, required: false, default: 'Service description not available' },
    tripNumber: { type: String },
    amount: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      default: 'pending',
      index: true
    },
    paidDate: { type: Date },
    paymentReceiptUrl: { type: String },
    pdfUrl: { type: String },
    emailDate: { type: Date },
    emailSubject: { type: String },
    notes: { type: String }
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
InvoiceSchema.index({ contractor: 1, status: 1 });
InvoiceSchema.index({ matchedClientId: 1, invoiceDate: -1 });
InvoiceSchema.index({ invoiceDate: -1 });
InvoiceSchema.index({ status: 1, invoiceDate: -1 });

// @ts-ignore - Complex mongoose type inference issue
export default mongoose.model('Invoice', InvoiceSchema);
