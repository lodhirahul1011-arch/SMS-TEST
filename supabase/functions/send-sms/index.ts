import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

interface SendSmsRequest {
  number: string;
  sender_id?: string;
  message?: string;
  button_clicked?: string;
  order_id?: string;
  awb?: string;
  otp?: string;
  valid_till?: string;
}

interface SmsSettings {
  api_key: string | null;
  sender_id: string | null;
  template_id: string | null;
  base_url: string | null;
}

interface ProviderResponse {
  status?: string | number | null;
  code?: string | number | null;
  description?: string | null;
  message?: string | null;
  error?: string | null;
  raw?: string;
  data?: {
    messageid?: string | null;
  };
}

interface LogInsertPayload {
  number: string;
  message: string | null;
  sender_id: string;
  status: string;
  button_clicked?: string | null;
  order_id?: string | null;
  awb?: string | null;
  otp?: string | null;
  valid_till?: string | null;
  provider_response: ProviderResponse | { error: string };
  message_id?: string | null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const maskValue = (value?: string | null) => {
  if (!value) return 'missing';
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
};

const buildSmsUrlForLog = (url: string, apiKey: string) => {
  return url.replace(apiKey, 'HIDDEN_API_KEY');
};

const stripDeliveryFields = (payload: LogInsertPayload) => {
  const basePayload = { ...payload };
  delete basePayload.button_clicked;
  delete basePayload.order_id;
  delete basePayload.awb;
  delete basePayload.otp;
  delete basePayload.valid_till;
  return basePayload;
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    console.log(`[send-sms:${requestId}] CORS preflight handled`);
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log(`[send-sms:${requestId}] Request received`, {
      method: req.method,
      url: req.url,
      contentType: req.headers.get('content-type'),
      hasAuthorization: Boolean(req.headers.get('authorization')),
      userAgent: req.headers.get('user-agent')
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log(`[send-sms:${requestId}] Supabase env check`, {
      supabaseUrl: supabaseUrl || 'missing',
      serviceRoleKey: maskValue(supabaseServiceKey)
    });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: savedSettings, error: settingsError } = await supabase
      .from('sms_settings')
      .select('api_key, sender_id, template_id, base_url')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<SmsSettings>();

    if (settingsError) {
      console.error(`[send-sms:${requestId}] Failed to load sms_settings`, settingsError);
    }

    // Prefer Supabase secrets, then fall back to the settings saved from the app UI.
    const apiKey = Deno.env.get('SMS_API_KEY') || savedSettings?.api_key || '';
    const templateId = Deno.env.get('SMS_TEMPLATE_ID') || savedSettings?.template_id || '';
    const baseUrl = Deno.env.get('SMS_BASE_URL') || savedSettings?.base_url || 'https://smsfortius.org/V2/apikey.php';
    const defaultSenderId = Deno.env.get('SMS_SENDER_ID') || savedSettings?.sender_id || 'GNETRA';

    const payload: SendSmsRequest = await req.json();
    const senderId = (payload.sender_id || defaultSenderId || '').trim();

    console.log(`[send-sms:${requestId}] SMS config and payload`, {
      hasSavedSettings: Boolean(savedSettings),
      apiKey: maskValue(apiKey),
      templateId: templateId || 'missing',
      baseUrl: baseUrl || 'missing',
      defaultSenderId,
      requestedSenderId: payload.sender_id || 'missing',
      finalSenderId: senderId,
      rawNumber: payload.number || 'missing',
      messageLength: payload.message?.length || 0,
      buttonClicked: payload.button_clicked,
      orderId: payload.order_id,
      awb: payload.awb,
      otp: payload.otp,
      validTill: payload.valid_till
    });

    // Normalize phone number
    const rawNumber = (payload.number || '').trim();
    const digits = rawNumber.replace(/\D/g, '');

    let number = '';
    if (digits.length === 10) {
      number = '91' + digits;
    } else if (digits.length === 12 && digits.startsWith('91')) {
      number = digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      number = '91' + digits.substring(1);
    } else {
      number = digits;
    }

    console.log(`[send-sms:${requestId}] Number normalization`, {
      rawNumber,
      digits,
      normalizedNumber: number
    });

    if (number.length !== 12 || !number.startsWith('91')) {
      console.warn(`[send-sms:${requestId}] Invalid mobile number`, {
        rawNumber,
        digits,
        normalizedNumber: number
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid mobile number. Enter a 10-digit Indian mobile number.',
          received: rawNumber
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Check if API credentials are configured
    if (!apiKey || !baseUrl) {
      console.error(`[send-sms:${requestId}] SMS API not configured`, {
        hasApiKey: Boolean(apiKey),
        hasBaseUrl: Boolean(baseUrl),
        templateId: templateId || 'missing',
        senderId
      });

      // Log the attempt without actually sending
      const missingConfigLogPayload: LogInsertPayload = {
        number: number,
        message: payload.message || null,
        sender_id: senderId,
        status: 'failed',
        button_clicked: payload.button_clicked || null,
        order_id: payload.order_id || null,
        awb: payload.awb || null,
        otp: payload.otp || null,
        valid_till: payload.valid_till || null,
        provider_response: { error: 'SMS API not configured. Please save API key and base URL in settings, or set Supabase SMS_* secrets.' }
      };

      let { data: logEntry, error: logError } = await supabase
        .from('sms_logs')
        .insert(missingConfigLogPayload)
        .select()
        .single();

      if (logError && String(logError.message || '').includes('button_clicked')) {
        console.warn(`[send-sms:${requestId}] Delivery log columns missing, retrying base log insert`, logError);
        const retry = await supabase
          .from('sms_logs')
          .insert(stripDeliveryFields(missingConfigLogPayload))
          .select()
          .single();
        logEntry = retry.data;
        logError = retry.error;
      }

      if (logError) {
        console.error(`[send-sms:${requestId}] Failed to save missing-config log`, logError);
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: 'SMS API not configured. Please save API key and base URL in settings, or set Supabase SMS_* secrets.',
          log_id: logEntry?.id
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Build SMS API URL for Fortius
    const smsUrl = `${baseUrl}?apikey=${encodeURIComponent(apiKey)}&senderid=${encodeURIComponent(senderId)}&templateid=${encodeURIComponent(templateId)}&number=${encodeURIComponent(number)}&message=${encodeURIComponent(payload.message || '')}`;

    console.log(`[send-sms:${requestId}] Sending SMS provider request`, {
      number,
      senderId,
      templateId: templateId || 'missing',
      messageLength: payload.message?.length || 0,
      smsUrl: buildSmsUrlForLog(smsUrl, apiKey)
    });

    // Send SMS via Fortius provider API
    let smsResponse;
    try {
      smsResponse = await fetch(smsUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
    } catch (fetchError) {
      console.error(`[send-sms:${requestId}] Provider fetch error`, fetchError);
      throw fetchError;
    }

    const responseText = await smsResponse.text();
    console.log(`[send-sms:${requestId}] Provider raw response`, {
      httpStatus: smsResponse.status,
      ok: smsResponse.ok,
      responseText
    });

    let providerResponse: ProviderResponse;

    try {
      providerResponse = JSON.parse(responseText);
    } catch {
      providerResponse = { raw: responseText, status: 'unknown' };
    }

    const responseLower = responseText.toLowerCase();
    const providerStatus = String(providerResponse?.status || '').toLowerCase();
    const providerCode = String(providerResponse?.code || '');

    // Determine status - Fortius returns various success indicators.
    // Do not treat every HTTP 200 as success; providers often return errors with 200.
    const isSuccess = (
      providerStatus === 'success' ||
      providerCode === '011' ||
      providerCode === '211' ||
      responseLower.includes('success') ||
      responseLower.includes('submitted') ||
      responseLower.includes('accepted')
    );

    console.log(`[send-sms:${requestId}] SMS send result`, {
      isSuccess,
      httpStatus: smsResponse.status,
      providerStatus,
      providerCode,
      providerResponse
    });

    // Log to database
    const smsLogPayload: LogInsertPayload = {
      number: number,
      message: payload.message || null,
      sender_id: senderId,
      status: isSuccess ? 'success' : 'failed',
      button_clicked: payload.button_clicked || null,
      order_id: payload.order_id || null,
      awb: payload.awb || null,
      otp: payload.otp || null,
      valid_till: payload.valid_till || null,
      provider_response: providerResponse,
      message_id: providerResponse?.data?.messageid || null
    };

    let { data: logEntry, error: logError } = await supabase
      .from('sms_logs')
      .insert(smsLogPayload)
      .select()
      .single();

    if (logError && String(logError.message || '').includes('button_clicked')) {
      console.warn(`[send-sms:${requestId}] Delivery log columns missing, retrying base log insert`, logError);
      const retry = await supabase
        .from('sms_logs')
        .insert(stripDeliveryFields(smsLogPayload))
        .select()
        .single();
      logEntry = retry.data;
      logError = retry.error;
    }

    if (logError) {
      console.error(`[send-sms:${requestId}] Failed to save sms_logs row`, logError);
    } else {
      console.log(`[send-sms:${requestId}] Saved sms_logs row`, {
        logId: logEntry?.id,
        status: isSuccess ? 'success' : 'failed'
      });
    }

    return new Response(
      JSON.stringify({
        success: isSuccess,
        error: isSuccess ? undefined : (
          providerResponse?.description ||
          providerResponse?.message ||
          providerResponse?.error ||
          responseText ||
          `SMS provider returned HTTP ${smsResponse.status}`
        ),
        number: number,
        sender_id: senderId,
        provider_response: providerResponse,
        log_id: logEntry?.id,
        request_id: requestId
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error(`[send-sms:${requestId}] Error in send-sms function`, error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: message,
        request_id: requestId
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
