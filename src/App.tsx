import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { Send, Phone, User, MessageSquare, History, CheckCircle, XCircle, Clock, Settings, Save, Package } from 'lucide-react';

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
  } | null;
  message_id: string | null;
  created_at: string;
}

const savedPhoneNumberKey = 'sms-lab-phone-number';

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

function App() {
  const [savedPhoneNumber, setSavedPhoneNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [number, setNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [senderId, setSenderId] = useState('GNETRA');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<SmsLog[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [activeTab, setActiveTab] = useState<'send' | 'delivery'>('delivery');
  const [deliveryNumber, setDeliveryNumber] = useState(() => localStorage.getItem(savedPhoneNumberKey) || '');
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliverySenderId, setDeliverySenderId] = useState('GNETRA');
  const [deliveryTime, setDeliveryTime] = useState('1pm');
  const [deliveryOtpLength, setDeliveryOtpLength] = useState<4 | 6>(4);

  useEffect(() => {
    fetchLogs();
    // Load credentials from environment variables
    const envApiKey = import.meta.env.VITE_SMS_API_KEY;
    const envSenderId = import.meta.env.VITE_SMS_SENDER_ID;
    const envTemplateId = import.meta.env.VITE_SMS_TEMPLATE_ID;
    const envBaseUrl = import.meta.env.VITE_SMS_BASE_URL;

    console.log('[SMS App] Runtime config check', {
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'missing',
      anonKey: maskValue(import.meta.env.VITE_SUPABASE_ANON_KEY),
      smsApiKey: maskValue(envApiKey),
      smsSenderId: envSenderId || 'missing',
      smsTemplateId: envTemplateId || 'missing',
      smsBaseUrl: envBaseUrl || 'missing'
    });

    if (envApiKey) setApiKey(envApiKey);
    if (envSenderId) setSenderId(envSenderId);
    if (envTemplateId) setTemplateId(envTemplateId);
    if (envBaseUrl) setBaseUrl(envBaseUrl);

    fetchSettings();
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
    const { data, error } = await supabase
      .from('sms_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('[SMS App] Failed to fetch SMS logs', error);
    }
    if (data) setLogs(data);
  };

  const fetchSettings = async () => {
    const { data, error } = await supabase
      .from('sms_settings')
      .select('*')
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('[SMS App] Failed to fetch SMS settings', error);
    }
    if (data) {
      setApiKey(data.api_key || '');
      setSenderId(data.sender_id || 'GNETRA');
      setTemplateId(data.template_id || '');
      setBaseUrl(data.base_url || '');
    }
  };

  const saveSettings = async () => {
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

  const sendSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!number.trim()) return;

    setLoading(true);
    try {
      const requestBody = {
        number: number.trim(),
        sender_id: senderId.trim() || 'GNETRA',
        message: message.trim()
      };
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`;

      console.log('[SMS App] Sending manual SMS request', {
        endpoint,
        number: requestBody.number,
        senderId: requestBody.sender_id,
        messageLength: requestBody.message.length,
        hasAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      const { parsed: result, raw } = await safeJson(response);
      console.log('[SMS App] Manual SMS response', {
        httpStatus: response.status,
        ok: response.ok,
        result,
        raw
      });

      if (result?.success) {
        setMessage('');
        fetchLogs();
      } else {
        alert(result?.error || raw || 'Failed to send SMS');
      }
    } catch (error) {
      console.error('[SMS App] Error sending manual SMS:', error);
      alert('Failed to send SMS. Please check your settings.');
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
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Clock className="w-5 h-5 text-amber-500" />;
    }
  };

  const generateOrderId = (): string => {
    // Generate 13-digit order ID (matching example: 6760322204547)
    return Math.floor(Math.random() * 10000000000000).toString().padStart(13, '0');
  };

  const generateAwb = (): string => {
    // Generate AWB alphanumeric (4 letters + 11 digits, matching: FMPP3917065945)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const randomLetters = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const randomNumbers = Math.floor(Math.random() * 100000000000).toString().padStart(11, '0');
    return randomLetters + randomNumbers;
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
    try {
      const orderId = generateOrderId();
      const awb = generateAwb();
      const otp = generateOtp(deliveryOtpLength);

      const deliveryMessage = `Dvaarikart:Your order ${orderId} (AWB:${awb}) is out for delivery. Open Box Delivery OTP:${otp} valid till ${deliveryTime} today. Please share OTP after checking the product condition. Delivery Partner: Dvaarikart - GRAHNETRA AI LABS`;
      const requestBody = {
        number: deliveryNumber.trim(),
        sender_id: deliverySenderId || 'GNETRA',
        message: deliveryMessage,
        order_id: orderId,
        awb: awb,
        otp: otp,
        valid_till: deliveryTime
      };
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`;

      console.log('[SMS App] Sending delivery OTP SMS request', {
        endpoint,
        number: requestBody.number,
        senderId: requestBody.sender_id,
        orderId,
        awb,
        otp,
        validTill: deliveryTime,
        messageLength: deliveryMessage.length,
        hasAnonKey: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY)
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      const { parsed: result, raw } = await safeJson(response);
      console.log('[SMS App] Delivery OTP SMS response', {
        httpStatus: response.status,
        ok: response.ok,
        result,
        raw
      });

      if (result?.success) {
        alert(`Delivery SMS sent successfully!\n\nOrder ID: ${orderId}\nAWB: ${awb}\nOTP: ${otp}\nValid Till: ${deliveryTime}`);
        fetchLogs();
      } else {
        alert(result?.error || raw || 'Failed to send delivery SMS');
      }
    } catch (error) {
      console.error('[SMS App] Error sending delivery SMS:', error);
      alert('Failed to send delivery SMS. Please check your settings.');
    } finally {
      setDeliveryLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl shadow-lg mb-4">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-2">SMS Notification Lab</h1>
          <p className="text-slate-600">Send SMS messages instantly with real-time tracking</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-8 max-w-2xl">
          <button
            onClick={() => setActiveTab('delivery')}
            className={`flex-1 py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'delivery'
                ? 'bg-blue-500 text-white shadow-lg'
                : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
            }`}
          >
            <Package className="w-4 h-4" />
            Delivery Order
          </button>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Form Container */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800">
                {activeTab === 'send' ? 'Send SMS' : 'Delivery Notification'}
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
                    placeholder="GNETRA"
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
                      placeholder="10-digit number (e.g. 8357032671)"
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
                    value={deliverySenderId}
                    onChange={(e) => setDeliverySenderId(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all bg-white"
                  >
                    <option value="GNETRA">GNETRA (verified)</option>
                    <option value="DVRKRT">DVRKRT</option>
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

          {/* SMS History */}
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
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>Sender: {log.sender_id}</span>
                      {log.message_id && <span>ID: {log.message_id}</span>}
                    </div>
                    {log.provider_response && (
                      <div className="mt-2 text-xs text-slate-500 bg-slate-100 rounded-lg p-2">
                        {log.provider_response.description || log.provider_response.status}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 text-slate-500 text-sm">
          <p>SMS Notification Lab - Powered by Supabase Edge Functions</p>
        </div>
      </div>
    </div>
  );
}

export default App;
