import mongoose from 'mongoose';

const smsLogSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, trim: true },
    message: { type: String, default: '' },
    sender_id: { type: String, default: 'DVRKRT', trim: true },
    status: { type: String, enum: ['submitted', 'success', 'failed', 'pending'], default: 'pending' },
    provider_response: { type: mongoose.Schema.Types.Mixed, default: null },
    message_id: { type: String, default: null },
    button_clicked: { type: String, default: null },
    order_id: { type: String, default: null },
    awb: { type: String, default: null },
    otp: { type: String, default: null },
    valid_till: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sms_logs'
  }
);

export const SmsLog = mongoose.model('SmsLog', smsLogSchema);
