import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  contractor: string;
  paymentDate: Date;
  amount: number;
  paymentMethod?: string; // 'check', 'ach', 'wire', etc.
  checkNumber?: string;
  confirmationNumber?: string;
  receiptUrl?: string; // URL to uploaded payment receipt/confirmation
  notes?: string;
  invoiceIds?: string[]; // Array of invoice IDs this payment covers
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema: Schema = new Schema(
  {
    contractor: { type: String, required: true, index: true },
    paymentDate: { type: Date, required: true, index: true },
    amount: { type: Number, required: true },
    paymentMethod: { type: String },
    checkNumber: { type: String },
    confirmationNumber: { type: String },
    receiptUrl: { type: String },
    notes: { type: String },
    invoiceIds: [{ type: String }]
  },
  {
    timestamps: true
  }
);

// Compound indexes for efficient queries
PaymentSchema.index({ contractor: 1, paymentDate: -1 });
PaymentSchema.index({ paymentDate: -1 });

// @ts-ignore - Complex mongoose type inference issue
export default mongoose.model<IPayment>('Payment', PaymentSchema);
