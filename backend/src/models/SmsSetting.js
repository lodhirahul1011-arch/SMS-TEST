import mongoose from 'mongoose';

const smsSettingSchema = new mongoose.Schema(
  {
    api_key: { type: String, default: '' },
    sender_id: { type: String, default: 'DVRKRT' },
    template_id: { type: String, default: '' },
    base_url: { type: String, default: 'https://smsfortius.org/V2/apikey.php' }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sms_settings'
  }
);

export const SmsSetting = mongoose.model('SmsSetting', smsSettingSchema);
