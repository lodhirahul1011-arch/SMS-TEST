import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured, supabasePublicKey, supabaseUrl } from './lib/supabase';
import {
  CheckCircle,
  Clipboard,
  Clock,
  History,
  Loader2,
  MessageSquare,
  Package,
  Phone,
  QrCode,
  Save,
  Send,
  Settings,
  User,
  XCircle
} from 'lucide-react';

interface SmsLog {
  id: string;
  number: string;
  message: string | null;
  sender_id: string | null;
  status: string;
  provider_response: {
    description?: string;
    status?: string;
    message?: string;
    error?: string;
    response_text?: string;
    success?: boolean;
    response_data?: {
      description?: string;
      status?: string;
      message?: string;
      code?: string;
    } | null;
  } | null;
  message_id: string | null;
  created_at: string;
  button_clicked?: string | null;
  order_id?: string | null;
  awb?: string | null;
  otp?: string | null;
  valid_till?: string | null;
}

interface FixedDelivery {
  id: string;
  label: string;
  orderId: string;
  awb: string;
  otp: string;
  validTill: string;
  color: string;
}

type DeliveryIdentifierType = 'orderId' | 'awb';

interface SendSmsPayload {
  number: string;
  sender_id: string;
  message: string;
  button_clicked?: string;
  order_id?: string;
  awb?: string;
  otp?: string;
  valid_till?: string;
}

interface SmsSettingsRecord {
  api_key?: string | null;
  sender_id?: string | null;
  template_id?: string | null;
  base_url?: string | null;
}

const savedPhoneNumberKey = 'sms-lab-phone-number';

const fixedDeliveries: FixedDelivery[] = [
  {
    id: 'delivery-1',
    label: 'Delivery 1',
    orderId: '5370227072497',
    awb: 'KGNL04406223600',
    otp: '2198',
    validTill: '5 pm',
    color: 'from-blue-600 to-indigo-600'
  },
  {
    id: 'delivery-2',
    label: 'Delivery 2',
    orderId: 'OD78437203839',
    awb: 'JIZJ63848104950',
    otp: '734219',
    validTill: '7pm',
    color: 'from-teal-600 to-emerald-600'
  },
  {
    id: 'delivery-3',
    label: 'Delivery 3',
    orderId: '8080254609466',
    awb: 'LTUF61749660227',
    otp: '753928',
    validTill: '1pm',
    color: 'from-orange-500 to-amber-500'
  },
  {
    id: 'delivery-4',
    label: 'Delivery 4',
    orderId: '7550450755625',
    awb: 'MRKN70852666002',
    otp: '1656',
    validTill: '2pm',
    color: 'from-green-600 to-lime-600'
  },
  {
    id: 'delivery-5',
    label: 'Delivery 5',
    orderId: '0536663617534',
    awb: 'MJWY68010552189',
    otp: '380648',
    validTill: '11 pm',
    color: 'from-rose-600 to-pink-600'
  }
];

const maskValue = (value?: string) => {
  if (!value) return 'missing';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

const safeJson = async (response: Response) => {
  const text = await response.text();
  try {
    return { parsed: JSON.parse(text), raw: text };
  } catch {
    return { parsed: null, raw: text };
  }
};

const smsProviderBaseUrl = import.meta.env.DEV
  ? import.meta.env.VITE_SMS_BASE_URL || 'https://smsfortius.org/V2/apikey.php'
  : '';
const smsProviderApiKey = import.meta.env.DEV ? import.meta.env.VITE_SMS_API_KEY || '' : '';
const smsProviderTemplateId = import.meta.env.DEV ? import.meta.env.VITE_SMS_TEMPLATE_ID || '' : '';
const backendApiBaseUrl = (
  import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? 'http://127.0.0.1:5000' : '')
).replace(/\/$/, '');
const hasSmsProviderConfig = Boolean(smsProviderApiKey && smsProviderTemplateId && smsProviderBaseUrl);
const isDevProxyEnabled = import.meta.env.DEV && Boolean(smsProviderBaseUrl && smsProviderApiKey && smsProviderTemplateId);
const hasBackendApi = Boolean(backendApiBaseUrl);

const getBackendApiUrl = (path: string) => {
  if (!backendApiBaseUrl) {
    throw new Error('Backend API URL is not configured.');
  }

  return `${backendApiBaseUrl}${path}`;
};

const extractTextField = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const parseJsonRecord = (value: unknown) => {
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const getProviderDescription = (providerResponse: SmsLog['provider_response'] | Record<string, unknown> | null | undefined) => {
  if (!providerResponse || typeof providerResponse !== 'object') return null;

  const directDescription =
    extractTextField(providerResponse.description) ||
    extractTextField(providerResponse.message) ||
    extractTextField(providerResponse.status);

  if (directDescription) return directDescription;

  const nestedResponse = providerResponse.response_data;
  if (nestedResponse && typeof nestedResponse === 'object') {
    const nestedDescription =
      extractTextField(nestedResponse.description) ||
      extractTextField(nestedResponse.message) ||
      extractTextField(nestedResponse.status);

    if (nestedDescription) return nestedDescription;
  }

  const parsedText = parseJsonRecord(providerResponse.response_text);
  if (parsedText) {
    return (
      extractTextField(parsedText.description) ||
      extractTextField(parsedText.message) ||
      extractTextField(parsedText.status)
    );
  }

  return extractTextField(providerResponse.response_text);
};

const buildSubmissionAlert = (title: string, details: string[], providerDescription?: string | null) => {
  const providerLine = providerDescription
    ? `Provider: ${providerDescription}`
    : 'Provider accepted the request.';

  return [
    title,
    ...details,
    '',
    providerLine,
    'Delivery to the handset is not confirmed yet.'
  ].join('\n');
};

const buildSmsProviderUrl = (number: string, message: string, senderId: string) => {
  if (!isDevProxyEnabled) return null;
  const params = new URLSearchParams({
    apikey: smsProviderApiKey,
    senderid: senderId,
    templateid: smsProviderTemplateId,
    number,
    message
  });

  return `/api/sms-provider?${params.toString()}`;
};

const sendViaSmsProvider = async (url: string) => {
  const response = await fetch(url, { method: 'GET' });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const lower = text.toLowerCase();
  const providerStatus = String(parsed?.status || '').toLowerCase();
  const providerCode = String(parsed?.code || '');
  const success =
    response.ok &&
    (providerStatus === 'success' ||
      providerCode === '011' ||
      providerCode === '211' ||
      lower.includes('success') ||
      lower.includes('submitted') ||
      lower.includes('accepted'));

  return {
    success,
    responseText: text,
    parsed
  };
};

const trySendViaProvider = async (body: { number: string; message: string; sender_id: string }) => {
  const providerUrl = buildSmsProviderUrl(body.number, body.message || '', body.sender_id || 'DVRKRT');
  if (!providerUrl) {
    throw new Error('Direct SMS provider calls are only available in local development through the Vite proxy.');
  }

  const providerResult = await sendViaSmsProvider(providerUrl);
  if (!providerResult.success) {
    throw new Error(
      providerResult.parsed?.error ||
        providerResult.parsed?.message ||
        providerResult.responseText ||
        'SMS provider returned an error.'
    );
  }

  return providerResult;
};

const isNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return /Failed to fetch|NetworkError|ENOTFOUND|getaddrinfo|DNS/.test(error.message);
};

const getSupabaseConfigurationError = () =>
  'Supabase is not configured for this deployment. Set VITE_SUPABASE_URL and either VITE_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY.';

const sendViaBackendApi = async <T,>(path: string, init?: RequestInit) => {
  if (!hasBackendApi) {
    throw new Error('Backend API is not configured.');
  }

  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(getBackendApiUrl(path), {
    ...init,
    headers
  });
  const { parsed, raw } = await safeJson(response);

  if (!response.ok) {
    throw new Error(parsed?.error || raw || `Backend API returned HTTP ${response.status}`);
  }

  return parsed as T;
};

const sendViaSupabaseFunction = async (
  requestBody: SendSmsPayload,
  logContext: Record<string, unknown>
) => {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error(getSupabaseConfigurationError());
  }

  const endpoint = `${supabaseUrl}/functions/v1/send-sms`;

  console.log('[SMS App] Sending SMS request via Supabase Edge Function', {
    endpoint,
    hasSupabasePublicKey: Boolean(supabasePublicKey),
    // This app deliberately uses a simple text/plain POST instead of
    // supabase.functions.invoke(). In some hosted browsers Supabase's
    // invoke headers trigger an OPTIONS preflight. If the function was
    // deployed without the local config, that preflight is rejected by the
    // gateway before our CORS handler runs. A simple request reaches the
    // Edge Function directly when verify_jwt=false.
    requestMode: 'simple-cors-safe-post',
    ...logContext
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      // text/plain is a CORS-safelisted content type, so the browser does
      // not send a preflight OPTIONS request. The Edge Function still parses
      // this JSON string with req.text()/JSON.parse.
      'Content-Type': 'text/plain;charset=UTF-8'
    },
    body: JSON.stringify(requestBody)
  });

  const { parsed, raw } = await safeJson(response);

  if (!response.ok) {
    throw new Error(parsed?.error || parsed?.details || raw || `Edge Function returned HTTP ${response.status}`);
  }

  if (!parsed?.success) {
    throw new Error(parsed?.error || parsed?.details || raw || 'Failed to send SMS');
  }

  return parsed;
};

const applySmsSettings = (
  settings: SmsSettingsRecord | null | undefined,
  setters: {
    setApiKey: (value: string) => void;
    setSenderId: (value: string) => void;
    setTemplateId: (value: string) => void;
    setBaseUrl: (value: string) => void;
  }
) => {
  if (!settings) return;

  setters.setApiKey(settings.api_key || '');
  setters.setSenderId(settings.sender_id || 'DVRKRT');
  setters.setTemplateId(settings.template_id || '');
  setters.setBaseUrl(settings.base_url || '');
};

function App() {
  const [savedPhoneNumber, setSavedPhoneNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [number, setNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [senderId, setSenderId] = useState('DVRKRT');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'send' | 'delivery' | 'prefixDelivery'>('delivery');
  const [deliveryNumber, setDeliveryNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState('1pm');
  const [deliveryOtpLength, setDeliveryOtpLength] = useState<4 | 6>(4);
  const [selectedFixedDelivery, setSelectedFixedDelivery] = useState<FixedDelivery | null>(null);
  const [fixedDeliveryLoadingId, setFixedDeliveryLoadingId] = useState<string | null>(null);
  const [confirmOrderId, setConfirmOrderId] = useState('');
  const [selectedIdentifierType, setSelectedIdentifierType] = useState<DeliveryIdentifierType>('orderId');
  const supabaseConfigured = isSupabaseConfigured;

  const selectedIdentifierLabel = selectedIdentifierType === 'orderId' ? 'Order ID' : 'AWB';
  const selectedIdentifierValue = selectedFixedDelivery
    ? selectedFixedDelivery[selectedIdentifierType]
    : '';
  const qrText = selectedIdentifierValue;
  const qrUrl = useMemo(
    () => (qrText ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrText)}` : ''),
    [qrText]
  );

  useEffect(() => {
    if (hasBackendApi || supabaseConfigured) {
      fetchLogs();
      fetchSettings();
    } else {
      console.warn(
        '[SMS App] Neither backend nor Supabase is configured. Set VITE_BACKEND_URL or the Supabase environment variables.'
      );
    }

    const envApiKey = import.meta.env.DEV ? import.meta.env.VITE_SMS_API_KEY : '';
    const envSenderId = import.meta.env.DEV ? import.meta.env.VITE_SMS_SENDER_ID : '';
    const envTemplateId = import.meta.env.DEV ? import.meta.env.VITE_SMS_TEMPLATE_ID : '';
    const envBaseUrl = import.meta.env.DEV ? import.meta.env.VITE_SMS_BASE_URL : '';

    console.log('[SMS App] Runtime config check', {
      backendApiUrl: backendApiBaseUrl || 'missing',
      supabaseUrl: supabaseUrl || 'missing',
      supabasePublicKey: maskValue(supabasePublicKey),
      supabaseKeySource: import.meta.env.VITE_SUPABASE_ANON_KEY
        ? 'anon'
        : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
          ? 'publishable'
          : 'missing',
      smsApiKey: import.meta.env.DEV ? maskValue(envApiKey) : 'dev-only',
      smsSenderId: import.meta.env.DEV ? envSenderId || 'missing' : 'dev-only',
      smsTemplateId: import.meta.env.DEV ? envTemplateId || 'missing' : 'dev-only',
      smsBaseUrl: import.meta.env.DEV ? envBaseUrl || 'missing' : 'dev-only'
    });

    if (envApiKey) setApiKey(envApiKey);
    if (envSenderId) setSenderId(envSenderId);
    if (envTemplateId) setTemplateId(envTemplateId);
    if (envBaseUrl) setBaseUrl(envBaseUrl);

  }, []);

  const savePhoneNumber = (value: string) => {
    const phoneNumber = value.trim();
    setSavedPhoneNumber(phoneNumber);
    setNumber(phoneNumber);
    setDeliveryNumber(phoneNumber);
    localStorage.setItem(savedPhoneNumberKey, phoneNumber);
  };

  const isNumberSaved = number.trim() !== '' && number.trim() === savedPhoneNumber;
  const isDeliveryNumberSaved = deliveryNumber.trim() !== '' && deliveryNumber.trim() === savedPhoneNumber;

  const fetchLogs = async () => {
    if (hasBackendApi) {
      try {
        const response = await sendViaBackendApi<{ success: boolean; data: SmsLog[] }>('/api/sms/logs?limit=20');
        setLogs(response.data || []);
        return;
      } catch (error) {
        console.warn('[SMS App] Backend SMS logs unavailable', error);
      }
    }

    if (!supabaseConfigured || !supabase) return;

    const { data, error } = await supabase
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn('[SMS App] SMS logs not available (table may not exist yet)', error.message);
    }
    if (data) setLogs(data);
  };

  const fetchSettings = async () => {
    if (hasBackendApi) {
      try {
        const response = await sendViaBackendApi<{ success: boolean; data: SmsSettingsRecord }>('/api/sms/settings');
        applySmsSettings(response.data, { setApiKey, setSenderId, setTemplateId, setBaseUrl });
        return;
      } catch (error) {
        console.warn('[SMS App] Backend SMS settings unavailable', error);
      }
    }

    if (!supabaseConfigured || !supabase) return;

    const { data, error } = await supabase
      .from('sms_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[SMS App] SMS settings not available (table may not exist yet)', error.message);
    }
    if (data) {
      applySmsSettings(data, { setApiKey, setSenderId, setTemplateId, setBaseUrl });
    }
  };

  const saveSettings = async () => {
    if (hasBackendApi) {
      const response = await sendViaBackendApi<{ success: boolean; data: SmsSettingsRecord }>('/api/sms/settings', {
        method: 'PUT',
        body: JSON.stringify({
          api_key: apiKey,
          sender_id: senderId,
          template_id: templateId,
          base_url: baseUrl
        })
      });

      applySmsSettings(response.data, { setApiKey, setSenderId, setTemplateId, setBaseUrl });
      setShowSettings(false);
      return;
    }

    if (!supabaseConfigured || !supabase) {
      alert('Neither backend nor Supabase is configured. Settings cannot be saved.');
      return;
    }

    const { data: existing } = await supabase
      .from('sms_settings')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('sms_settings')
        .update({
          api_key: apiKey,
          sender_id: senderId,
          template_id: templateId,
          base_url: baseUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('sms_settings')
        .insert({
          api_key: apiKey,
          sender_id: senderId,
          template_id: templateId,
          base_url: baseUrl
        });
    }
    setShowSettings(false);
  };
// jj
  const sendSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) return;

    setLoading(true);
    const requestBody = {
      number: normalizePhoneNumber(number.trim()),
      sender_id: senderId.trim() || 'DVRKRT',
      message: message.trim()
    };

    const sendViaSupabase = async () => {
      await sendViaSupabaseFunction(requestBody, {
        action: 'manual',
        number: requestBody.number,
        senderId: requestBody.sender_id,
        messageLength: requestBody.message.length
      });
      setMessage('');
      fetchLogs();
    };

    try {
      if (hasBackendApi) {
        console.log('[SMS App] Sending manual SMS via backend API');
        const backendResult = await sendViaBackendApi<{
          success: boolean;
          warning?: string;
          provider?: SmsLog['provider_response'];
        }>('/api/sms/send', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        console.log('[SMS App] Backend response', backendResult);
        setMessage('');
        fetchLogs();
        alert(
          buildSubmissionAlert(
            'SMS submitted to provider.',
            [`Number: ${requestBody.number}`],
            backendResult.warning || getProviderDescription(backendResult.provider)
          )
        );
      } else if (isDevProxyEnabled) {
        console.log('[SMS App] Development mode: using direct SMS provider via proxy');
        const providerResult = await trySendViaProvider(requestBody);
        console.log('[SMS App] Provider response', providerResult);
        setMessage('');
        alert(
          buildSubmissionAlert(
            'SMS submitted to provider.',
            [`Number: ${requestBody.number}`],
            getProviderDescription(providerResult.parsed as Record<string, unknown>)
          )
        );
      } else if (supabaseConfigured) {
        try {
          await sendViaSupabase();
          alert(buildSubmissionAlert('SMS submitted to provider.', [`Number: ${requestBody.number}`]));
        } catch (error) {
          if (import.meta.env.DEV && isNetworkError(error) && hasSmsProviderConfig) {
            console.warn('[SMS App] Supabase unreachable, falling back to direct provider', error);
            const providerResult = await trySendViaProvider(requestBody);
            console.log('[SMS App] Provider response', providerResult);
            setMessage('');
            alert(
              buildSubmissionAlert(
                'SMS submitted to provider.',
                [`Number: ${requestBody.number}`],
                getProviderDescription(providerResult.parsed as Record<string, unknown>)
              )
            );
          } else {
            throw error;
          }
        }
      } else {
        throw new Error(getSupabaseConfigurationError());
      }
    } catch (error) {
      console.error('[SMS App] Error sending manual SMS:', error);
      alert(`Failed to send SMS. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'success':
        return <CheckCircle className="w-5 h-5 text-emerald-500" />;
      case 'submitted':
        return <Clock className="w-5 h-5 text-amber-500" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-amber-500" />;
    }
  };

  const normalizePhoneNumber = (phone: string): string => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return '91' + digits;
    } else if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      return '91' + digits.substring(1);
    }
    return digits;
  };

  const generateAwb = (): string => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const randomLetters = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const randomNumbers = Math.floor(Math.random() * 100000000000).toString().padStart(11, '0');
    return randomLetters + randomNumbers;
  };

  const generateOrderId = (): string => {
    const timestamp = Date.now().toString().slice(-8);
    const randomDigits = Math.floor(1000 + Math.random() * 9000).toString();
    return `DV${timestamp}${randomDigits}`;
  };

  const generateOtp = (length: 4 | 6): string => {
    if (length === 4) {
      return Math.floor(1000 + Math.random() * 9000).toString();
    } else {
      return Math.floor(100000 + Math.random() * 900000).toString();
    }
  };

  const sendDeliveryNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliveryNumber.trim()) return;

    setDeliveryLoading(true);
    const orderId = generateOrderId();
    const awb = generateAwb();
    const otp = generateOtp(deliveryOtpLength);

    const deliveryMessage = `Dvaarikart:Your order ${orderId} (AWB:${awb}) is out for delivery. Open Box Delivery OTP:${otp} valid till ${deliveryTime} today. Please share OTP after checking the product condition. Delivery Partner: Dvaarikart - GRAHNETRA AI LABS`;
    const requestBody = {
      number: normalizePhoneNumber(deliveryNumber.trim()),
      sender_id: 'DVRKRT',
      message: deliveryMessage,
      order_id: orderId,
      awb: awb,
      otp: otp,
      valid_till: deliveryTime
    };

    const sendViaSupabase = async () => {
      await sendViaSupabaseFunction(requestBody, {
        action: 'delivery',
        number: requestBody.number,
        senderId: requestBody.sender_id,
        orderId,
        awb,
        otp,
        validTill: deliveryTime,
        messageLength: deliveryMessage.length
      });
      alert(
        buildSubmissionAlert('Delivery SMS submitted to provider.', [
          `Order ID: ${orderId}`,
          `AWB: ${awb}`,
          `OTP: ${otp}`,
          `Valid Till: ${deliveryTime}`
        ])
      );
      fetchLogs();
    };

    try {
      if (hasBackendApi) {
        console.log('[SMS App] Sending delivery SMS via backend API');
        const backendResult = await sendViaBackendApi<{
          success: boolean;
          warning?: string;
          provider?: SmsLog['provider_response'];
        }>('/api/sms/send', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        console.log('[SMS App] Backend response', backendResult);
        fetchLogs();
        alert(
          buildSubmissionAlert(
            'Delivery SMS submitted to provider.',
            [`Order ID: ${orderId}`, `AWB: ${awb}`, `OTP: ${otp}`, `Valid Till: ${deliveryTime}`],
            backendResult.warning || getProviderDescription(backendResult.provider)
          )
        );
      } else if (isDevProxyEnabled) {
        console.log('[SMS App] Development mode: using direct SMS provider via proxy for delivery');
        const providerResult = await trySendViaProvider(requestBody);
        console.log('[SMS App] Provider response', providerResult);
        alert(
          buildSubmissionAlert(
            'Delivery SMS submitted to provider.',
            [`Order ID: ${orderId}`, `AWB: ${awb}`, `OTP: ${otp}`, `Valid Till: ${deliveryTime}`],
            getProviderDescription(providerResult.parsed as Record<string, unknown>)
          )
        );
      } else if (supabaseConfigured) {
        try {
          await sendViaSupabase();
        } catch (error) {
          if (import.meta.env.DEV && isNetworkError(error) && hasSmsProviderConfig) {
            console.warn('[SMS App] Supabase unreachable, falling back to direct provider', error);
            const providerResult = await trySendViaProvider(requestBody);
            console.log('[SMS App] Provider response', providerResult);
            alert(
              buildSubmissionAlert(
                'Delivery SMS submitted to provider.',
                [`Order ID: ${orderId}`, `AWB: ${awb}`, `OTP: ${otp}`, `Valid Till: ${deliveryTime}`],
                getProviderDescription(providerResult.parsed as Record<string, unknown>)
              )
            );
          } else {
            throw error;
          }
        }
      } else {
        throw new Error(getSupabaseConfigurationError());
      }
    } catch (error) {
      console.error('[SMS App] Error sending delivery SMS:', error);
      alert(`Failed to send delivery SMS. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDeliveryLoading(false);
    }
  };

  const sendFixedDeliveryNotification = async (delivery: FixedDelivery) => {
    if (!deliveryNumber.trim()) return;

    setSelectedFixedDelivery(delivery);
    setSelectedIdentifierType('orderId');
    setConfirmOrderId('');
    setFixedDeliveryLoadingId(delivery.id);

    const deliveryMessage = `Dvaarikart:Your order ${delivery.orderId} (AWB:${delivery.awb}) is out for delivery. Open Box Delivery OTP:${delivery.otp} valid till ${delivery.validTill} today. Please share OTP after checking the product condition. Delivery Partner: Dvaarikart - GRAHNETRA AI LABS`;
    const requestBody = {
      number: normalizePhoneNumber(deliveryNumber.trim()),
      sender_id: 'DVRKRT',
      message: deliveryMessage,
      button_clicked: delivery.label,
      order_id: delivery.orderId,
      awb: delivery.awb,
      otp: delivery.otp,
      valid_till: delivery.validTill
    };

    const sendViaSupabase = async () => {
      await sendViaSupabaseFunction(requestBody, {
        action: 'prefix-delivery',
        number: requestBody.number,
        senderId: requestBody.sender_id,
        buttonClicked: delivery.label,
        orderId: delivery.orderId,
        awb: delivery.awb,
        otp: delivery.otp,
        validTill: delivery.validTill,
        messageLength: deliveryMessage.length
      });
      alert(
        buildSubmissionAlert('Prefix Delivery SMS submitted to provider.', [
          `Order ID: ${delivery.orderId}`,
          `AWB: ${delivery.awb}`,
          `OTP: ${delivery.otp}`,
          `Valid Till: ${delivery.validTill}`
        ])
      );
      fetchLogs();
    };

    try {
      if (hasBackendApi) {
        console.log('[SMS App] Sending fixed delivery SMS via backend API');
        const backendResult = await sendViaBackendApi<{
          success: boolean;
          warning?: string;
          provider?: SmsLog['provider_response'];
        }>('/api/sms/send', {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });
        console.log('[SMS App] Backend response', backendResult);
        fetchLogs();
        alert(
          buildSubmissionAlert(
            'Prefix Delivery SMS submitted to provider.',
            [
              `Order ID: ${delivery.orderId}`,
              `AWB: ${delivery.awb}`,
              `OTP: ${delivery.otp}`,
              `Valid Till: ${delivery.validTill}`
            ],
            backendResult.warning || getProviderDescription(backendResult.provider)
          )
        );
      } else if (isDevProxyEnabled) {
        console.log('[SMS App] Development mode: using direct SMS provider via proxy for fixed delivery');
        const providerResult = await trySendViaProvider(requestBody);
        console.log('[SMS App] Provider response', providerResult);
        alert(
          buildSubmissionAlert(
            'Prefix Delivery SMS submitted to provider.',
            [
              `Order ID: ${delivery.orderId}`,
              `AWB: ${delivery.awb}`,
              `OTP: ${delivery.otp}`,
              `Valid Till: ${delivery.validTill}`
            ],
            getProviderDescription(providerResult.parsed as Record<string, unknown>)
          )
        );
      } else if (supabaseConfigured) {
        try {
          await sendViaSupabase();
        } catch (error) {
          if (import.meta.env.DEV && isNetworkError(error) && hasSmsProviderConfig) {
            console.warn('[SMS App] Supabase unreachable, falling back to direct provider', error);
            const providerResult = await trySendViaProvider(requestBody);
            console.log('[SMS App] Provider response', providerResult);
            alert(
              buildSubmissionAlert(
                'Prefix Delivery SMS submitted to provider.',
                [
                  `Order ID: ${delivery.orderId}`,
                  `AWB: ${delivery.awb}`,
                  `OTP: ${delivery.otp}`,
                  `Valid Till: ${delivery.validTill}`
                ],
                getProviderDescription(providerResult.parsed as Record<string, unknown>)
              )
            );
          } else {
            throw error;
          }
        }
      } else {
        throw new Error(getSupabaseConfigurationError());
      }
    } catch (error) {
      console.error('[SMS App] Error sending prefix delivery SMS:', error);
      alert(`Failed to send prefix delivery SMS. ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setFixedDeliveryLoadingId(null);
    }
  };

  const copySelectedOrderId = async () => {
    if (!selectedFixedDelivery) return;
    await navigator.clipboard.writeText(selectedIdentifierValue);
  };

  const confirmSelectedDelivery = () => {
    if (!selectedFixedDelivery) {
      alert('Select a delivery first.');
      return;
    }
    if (confirmOrderId.trim() !== selectedIdentifierValue) {
      alert(`${selectedIdentifierLabel} does not match selected delivery.`);
      return;
    }
    alert(`Confirmed: ${selectedIdentifierLabel} ${selectedIdentifierValue}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-lg mb-4">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-2">SMS Notification Lab</h1>
          <p className="text-slate-600">Send SMS messages instantly with real-time tracking</p>
        </div>

        {!supabaseConfigured && !hasBackendApi && !isDevProxyEnabled && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 mb-6 text-amber-900">
            Neither backend nor Supabase is configured for this deployment. Add <code>VITE_BACKEND_URL</code> or configure the Supabase environment variables.
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-2 mb-8 max-w-4xl">
          <button
            onClick={() => setActiveTab('send')}
            className={`py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'send'
                ? 'bg-blue-500 text-white shadow-lg'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            Send SMS
          </button>
          <button
            onClick={() => setActiveTab('delivery')}
            className={`py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'delivery'
                ? 'bg-blue-500 text-white shadow-lg'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <Package className="w-4 h-4" />
            Delivery Order
          </button>
          <button
            onClick={() => setActiveTab('prefixDelivery')}
            className={`py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'prefixDelivery'
                ? 'bg-blue-500 text-white shadow-lg'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <QrCode className="w-4 h-4" />
            Prefix Delivery SMS
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800">
                {activeTab === 'send'
                  ? 'Send SMS'
                  : activeTab === 'prefixDelivery'
                    ? 'Prefix Delivery SMS'
                    : 'Delivery Notification'}
              </h2>
              {activeTab === 'send' && (
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <Settings className="w-5 h-5 text-slate-600" />
                </button>
              )}
            </div>

            {activeTab === 'send' && showSettings ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">API Key</label>
                  <input
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="Enter your SMS API key"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Base URL</label>
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="SMS API base URL"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Template ID</label>
                  <input
                    type="text"
                    value={templateId}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="SMS template ID"
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={saveSettings}
                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                  >
                    Save Settings
                  </button>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="px-4 py-3 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : activeTab === 'send' ? (
              <form onSubmit={sendSms} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Mobile Number
                    </div>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      className="min-w-0 flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="10-digit number (e.g. 7692937264)"
                      inputMode="numeric"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => savePhoneNumber(number)}
                      disabled={!number.trim() || isNumberSaved}
                      className="shrink-0 px-4 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <Save className="w-4 h-4" />
                      {isNumberSaved ? 'Saved' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Enter 10-digit Indian mobile number</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      Sender ID
                    </div>
                  </label>
                  <input
                    type="text"
                    value={senderId}
                    onChange={(e) => setSenderId(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="DVRKRT"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Message (Optional)
                    </div>
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    rows={3}
                    placeholder="Enter your message..."
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || !number.trim()}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Send SMS
                    </>
                  )}
                </button>
              </form>
            ) : activeTab === 'prefixDelivery' ? (
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Recipient Mobile Number
                    </div>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={deliveryNumber}
                      onChange={(e) => setDeliveryNumber(e.target.value)}
                      className="min-w-0 flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="10-digit number (same user receives SMS)"
                      inputMode="numeric"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => savePhoneNumber(deliveryNumber)}
                      disabled={!deliveryNumber.trim() || isDeliveryNumberSaved}
                      className="shrink-0 px-4 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <Save className="w-4 h-4" />
                      {isDeliveryNumberSaved ? 'Saved' : 'Save'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Sender ID</label>
                  <select
                    value="DVRKRT"
                    disabled
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-700"
                  >
                    <option value="DVRKRT">DVRKRT (verified)</option>
                  </select>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {fixedDeliveries.map((delivery) => (
                    <button
                      key={delivery.id}
                      type="button"
                      onClick={() => sendFixedDeliveryNotification(delivery)}
                      disabled={fixedDeliveryLoadingId !== null || !deliveryNumber.trim()}
                      className={`min-h-24 rounded-xl bg-gradient-to-r ${delivery.color} disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold px-4 py-4 transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex flex-col items-center justify-center gap-2`}
                    >
                      {fixedDeliveryLoadingId === delivery.id ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Package className="w-5 h-5" />
                      )}
                      {delivery.label}
                    </button>
                  ))}
                </div>

                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <p className="text-sm text-slate-700 font-medium mb-3">Fixed Delivery Data:</p>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p>Order ID: <span className="font-mono text-slate-800">{selectedFixedDelivery?.orderId || 'Select a delivery'}</span></p>
                    <p>AWB: <span className="font-mono text-slate-800">{selectedFixedDelivery?.awb || 'Select a delivery'}</span></p>
                    <p>OTP: <span className="font-mono text-slate-800">{selectedFixedDelivery?.otp || 'Select a delivery'}</span></p>
                    <p>Valid Till: <span className="font-mono text-slate-800">{selectedFixedDelivery?.validTill || 'Select a delivery'}</span></p>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={sendDeliveryNotification} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Recipient Mobile Number
                    </div>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={deliveryNumber}
                      onChange={(e) => setDeliveryNumber(e.target.value)}
                      className="min-w-0 flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="10-digit number (e.g. 9111111111)"
                      inputMode="numeric"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => savePhoneNumber(deliveryNumber)}
                      disabled={!deliveryNumber.trim() || isDeliveryNumberSaved}
                      className="shrink-0 px-4 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
                    >
                      <Save className="w-4 h-4" />
                      {isDeliveryNumberSaved ? 'Saved' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Enter 10-digit Indian mobile number</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Sender ID</label>
                  <select
                    value="DVRKRT"
                    disabled
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg bg-slate-50 text-slate-700"
                  >
                    <option value="DVRKRT">DVRKRT (verified)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Valid Till Time</label>
                  <select
                    value={deliveryTime}
                    onChange={(e) => setDeliveryTime(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white"
                  >
                    <option value="8am">8am</option>
                    <option value="9am">9am</option>
                    <option value="10am">10am</option>
                    <option value="11am">11am</option>
                    <option value="12pm">12pm</option>
                    <option value="1pm">1pm</option>
                    <option value="2pm">2pm</option>
                    <option value="3pm">3pm</option>
                    <option value="4pm">4pm</option>
                    <option value="5pm">5pm</option>
                    <option value="6pm">6pm</option>
                    <option value="7pm">7pm</option>
                    <option value="8pm">8pm</option>
                    <option value="9pm">9pm</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">OTP Digits</label>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                    {[4, 6].map((length) => (
                      <button
                        key={length}
                        type="button"
                        onClick={() => setDeliveryOtpLength(length as 4 | 6)}
                        className={`rounded-md px-4 py-3 text-sm font-semibold transition-all ${
                          deliveryOtpLength === length
                            ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {length} Digit
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                  <p className="text-sm text-slate-700 font-medium mb-3">Auto-generated Details:</p>
                  <div className="space-y-2 text-sm text-slate-600">
                    <p>Order ID: <span className="font-mono text-slate-800">Generated on send</span></p>
                    <p>AWB: <span className="font-mono text-slate-800">Generated on send</span></p>
                    <p>OTP: <span className="font-mono text-slate-800">{deliveryOtpLength} digit, generated on send</span></p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={deliveryLoading || !deliveryNumber.trim()}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 disabled:from-slate-300 disabled:to-slate-400 text-white font-semibold py-4 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex items-center justify-center gap-2"
                >
                  {deliveryLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending Delivery SMS...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      Send Delivery Notification
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          <div className="space-y-8">
            {activeTab === 'prefixDelivery' && (
              <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
                <div className="flex items-center gap-2 mb-6">
                  <QrCode className="w-5 h-5 text-slate-600" />
                  <h2 className="text-xl font-semibold text-slate-800">QR Code</h2>
                </div>

                {selectedFixedDelivery ? (
                  <div className="space-y-5">
                    <div className="flex justify-center rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <img className="h-56 w-56" src={qrUrl} alt={`${selectedIdentifierValue} QR code`} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIdentifierType('orderId');
                          setConfirmOrderId('');
                        }}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                          selectedIdentifierType === 'orderId'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Order ID
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedIdentifierType('awb');
                          setConfirmOrderId('');
                        }}
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                          selectedIdentifierType === 'awb'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        AWB
                      </button>
                    </div>
                    <textarea
                      readOnly
                      value={selectedIdentifierValue}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg resize-none font-mono text-sm"
                      rows={1}
                    />
                    <input
                      value={confirmOrderId}
                      onChange={(e) => setConfirmOrderId(e.target.value)}
                      className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono"
                      placeholder={`Enter ${selectedIdentifierLabel} manually`}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={confirmSelectedDelivery}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-medium py-3 px-4 rounded-lg transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmOrderId(selectedIdentifierValue)}
                        className="border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-lg transition-colors"
                      >
                        Scan QR
                      </button>
                      <button
                        type="button"
                        onClick={copySelectedOrderId}
                        className="border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center"
                        title={`Copy ${selectedIdentifierLabel}`}
                      >
                        <Clipboard className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500 border border-dashed border-slate-300 rounded-xl">
                    <QrCode className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>Select a fixed delivery button to show QR</p>
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
              <div className="flex items-center gap-2 mb-6">
                <History className="w-5 h-5 text-slate-600" />
                <h2 className="text-xl font-semibold text-slate-800">Recent Messages</h2>
              </div>

              <div className="space-y-3 max-h-[500px] overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No messages sent yet</p>
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-slate-50 rounded-xl p-4 border border-slate-200 hover:border-slate-300 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(log.status)}
                          <span className="font-medium text-slate-800">{log.number}</span>
                        </div>
                        <span className="text-xs text-slate-500">{formatDate(log.created_at)}</span>
                      </div>
                      {log.message && (
                        <p className="text-sm text-slate-600 mb-2">{log.message}</p>
                      )}
                      {(log.order_id || log.awb || log.otp || log.valid_till || log.button_clicked) && (
                        <div className="grid sm:grid-cols-2 gap-2 text-xs text-slate-600 bg-white rounded-lg p-3 mb-2">
                          <span>Button: {log.button_clicked || '-'}</span>
                          <span>Order ID: {log.order_id || '-'}</span>
                          <span>AWB: {log.awb || '-'}</span>
                          <span>OTP: {log.otp || '-'}</span>
                          <span>Valid Till: {log.valid_till || '-'}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span>Sender: {log.sender_id}</span>
                        {log.message_id && <span>ID: {log.message_id}</span>}
                      </div>
                      {log.provider_response && (
                        <div className="mt-2 text-xs text-slate-500 bg-slate-100 rounded-lg p-2">
                          {getProviderDescription(log.provider_response) || 'Provider response available'}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-center mt-10 text-slate-500 text-sm">
          <p>SMS Notification Lab - Powered by Supabase Edge Functions</p>
        </div>
      </div>
    </div>
  );
}

export default App;
