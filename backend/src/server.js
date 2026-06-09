import 'dotenv/config';
import dns from 'node:dns';
import { isIP } from 'node:net';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import axios from 'axios';
import mongoose from 'mongoose';
import { SmsLog } from './models/SmsLog.js';
import { SmsSetting } from './models/SmsSetting.js';
import { isValidIndianSmsNumber, normalizeIndianMobile } from './utils/phone.js';

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

function getMongoDnsServers(mongoUri) {
  const configuredServers = (process.env.MONGO_DNS_SERVERS || process.env.DNS_SERVERS || '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);

  const fallbackServers = mongoUri.startsWith('mongodb+srv://') ? ['1.1.1.1', '8.8.8.8'] : [];
  return (configuredServers.length > 0 ? configuredServers : fallbackServers).filter((server) => isIP(server));
}

function configureMongoDns(mongoUri) {
  const dnsServers = getMongoDnsServers(mongoUri);
  if (dnsServers.length === 0) return;

  dns.setServers(dnsServers);
  console.log(`[Backend] Using DNS servers for MongoDB lookup: ${dnsServers.join(', ')}`);
}

async function connectDb() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is missing in backend environment variables.');

  configureMongoDns(mongoUri);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 20000 });
    console.log('[Backend] MongoDB connected');
  } catch (error) {
    if (error?.code === 'ECONNREFUSED' && error?.syscall === 'querySrv') {
      error.message = `${error.message}. MongoDB SRV DNS lookup failed. Set MONGO_DNS_SERVERS=1.1.1.1,8.8.8.8 or use the non-SRV Atlas connection string.`;
    }

    throw error;
  }
}

async function getActiveSettings() {
  const dbSetting = await SmsSetting.findOne().sort({ created_at: -1 }).lean();
  return {
    api_key: dbSetting?.api_key || process.env.SMS_API_KEY || '',
    sender_id: dbSetting?.sender_id || process.env.SMS_SENDER_ID || 'DVRKRT',
    template_id: dbSetting?.template_id || process.env.SMS_TEMPLATE_ID || '',
    base_url: dbSetting?.base_url || process.env.SMS_BASE_URL || 'https://smsfortius.org/V2/apikey.php'
  };
}

function parseProviderSuccess(responseData, responseText, httpOk) {
  const lower = String(responseText || '').toLowerCase();
  const status = String(responseData?.status || '').toLowerCase();
  const code = String(responseData?.code || responseData?.statusCode || '');

  return Boolean(
    httpOk &&
      (status === 'success' ||
        code === '011' ||
        code === '211' ||
        lower.includes('success') ||
        lower.includes('submitted') ||
        lower.includes('accepted'))
  );
}

async function sendSmsThroughProvider({ number, message, sender_id }) {
  const settings = await getActiveSettings();

  if (!settings.api_key) throw new Error('SMS_API_KEY is missing. Add it in Render backend env or save settings.');
  if (!settings.template_id) throw new Error('SMS_TEMPLATE_ID is missing. Add it in Render backend env or save settings.');
  if (!settings.base_url) throw new Error('SMS_BASE_URL is missing.');

  const params = {
    apikey: settings.api_key,
    senderid: sender_id || settings.sender_id || 'DVRKRT',
    templateid: settings.template_id,
    number,
    message: message || ''
  };

  const response = await axios.get(settings.base_url, {
    params,
    timeout: 20000,
    validateStatus: () => true
  });

  const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const success = parseProviderSuccess(response.data, responseText, response.status >= 200 && response.status < 300);

  return {
    success,
    http_status: response.status,
    response_text: responseText,
    response_data: response.data,
    message_id: response.data?.messageid || response.data?.message_id || response.data?.data?.message_id || null
  };
}

app.get('/api/health', async (_req, res) => {
  res.json({
    success: true,
    service: 'sms-test-backend',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    time: new Date().toISOString()
  });
});

app.post('/api/sms/send', async (req, res) => {
  const payload = req.body || {};
  const normalizedNumber = normalizeIndianMobile(payload.number);

  if (!isValidIndianSmsNumber(normalizedNumber)) {
    return res.status(400).json({ success: false, error: 'Invalid Indian mobile number. Use 10 digits or 91XXXXXXXXXX.' });
  }

  const log = await SmsLog.create({
    number: normalizedNumber,
    message: payload.message || '',
    sender_id: payload.sender_id || process.env.SMS_SENDER_ID || 'DVRKRT',
    status: 'pending',
    button_clicked: payload.button_clicked || null,
    order_id: payload.order_id || null,
    awb: payload.awb || null,
    otp: payload.otp || null,
    valid_till: payload.valid_till || null
  });

  try {
    const provider = await sendSmsThroughProvider({
      number: normalizedNumber,
      message: payload.message || '',
      sender_id: payload.sender_id || process.env.SMS_SENDER_ID || 'DVRKRT'
    });

    log.status = provider.success ? 'submitted' : 'failed';
    log.provider_response = provider;
    log.message_id = provider.message_id;
    await log.save();

    if (!provider.success) {
      return res.status(502).json({
        success: false,
        error: 'SMS provider returned failed response.',
        data: log,
        provider
      });
    }

    return res.json({
      success: true,
      delivery_status: 'submitted',
      warning: 'Provider accepted the message. Handset delivery is not confirmed yet.',
      data: log,
      provider
    });
  } catch (error) {
    log.status = 'failed';
    log.provider_response = { error: error.message };
    await log.save();

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send SMS.',
      data: log
    });
  }
});

app.get('/api/sms/logs', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const logs = await SmsLog.find().sort({ created_at: -1 }).limit(limit).lean();
  res.json({ success: true, data: logs });
});

app.get('/api/sms/settings', async (_req, res) => {
  const settings = await getActiveSettings();
  res.json({ success: true, data: settings });
});

app.put('/api/sms/settings', async (req, res) => {
  const body = req.body || {};
  const update = {
    api_key: body.api_key || '',
    sender_id: body.sender_id || 'DVRKRT',
    template_id: body.template_id || '',
    base_url: body.base_url || 'https://smsfortius.org/V2/apikey.php'
  };

  const existing = await SmsSetting.findOne().sort({ created_at: -1 });
  const saved = existing
    ? await SmsSetting.findByIdAndUpdate(existing._id, update, { new: true })
    : await SmsSetting.create(update);

  res.json({ success: true, data: saved });
});

app.use((err, _req, res, _next) => {
  console.error('[Backend] Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Server error' });
});

connectDb()
  .then(() => {
    app.listen(PORT, () => console.log(`[Backend] Server running on port ${PORT}`));
  })
  .catch((error) => {
    console.error('[Backend] Failed to start:', error.message);
    process.exit(1);
  });
