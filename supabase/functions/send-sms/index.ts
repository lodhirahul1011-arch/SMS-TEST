import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

interface SendSmsRequest {
  number: string;
  sender_id?: string;
  message?: string;
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: savedSettings } = await supabase
      .from('sms_settings')
      .select('api_key, sender_id, template_id, base_url')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle<SmsSettings>();

    // Prefer Supabase secrets, then fall back to the settings saved from the app UI.
    const apiKey = Deno.env.get('SMS_API_KEY') || savedSettings?.api_key || '';
    const templateId = Deno.env.get('SMS_TEMPLATE_ID') || savedSettings?.template_id || '';
    const baseUrl = Deno.env.get('SMS_BASE_URL') || savedSettings?.base_url || 'https://smsfortius.org/V2/apikey.php';
    const defaultSenderId = Deno.env.get('SMS_SENDER_ID') || savedSettings?.sender_id || 'GNETRA';

    const payload: SendSmsRequest = await req.json();
    const senderId = (payload.sender_id || defaultSenderId || '').trim();

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

    if (number.length !== 12 || !number.startsWith('91')) {
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
      // Log the attempt without actually sending
      const { data: logEntry } = await supabase
        .from('sms_logs')
        .insert({
          number: number,
          message: payload.message || null,
          sender_id: senderId,
          status: 'failed',
          provider_response: { error: 'SMS API not configured. Please save API key and base URL in settings, or set Supabase SMS_* secrets.' }
        })
        .select()
        .single();

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

    console.log('Sending SMS to:', number);
    console.log('SMS URL:', smsUrl.replace(apiKey, 'HIDDEN'));
    console.log('Message:', payload.message);

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
      console.error('Fetch error:', fetchError);
      throw fetchError;
    }

    const responseText = await smsResponse.text();
    console.log('API Response:', responseText);

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

    console.log('SMS Send Result:', { isSuccess, status: smsResponse.status, providerResponse });

    // Log to database
    const { data: logEntry } = await supabase
      .from('sms_logs')
      .insert({
        number: number,
        message: payload.message || null,
        sender_id: senderId,
        status: isSuccess ? 'success' : 'failed',
        provider_response: providerResponse,
        message_id: providerResponse?.data?.messageid || null
      })
      .select()
      .single();

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
        log_id: logEntry?.id
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in send-sms function:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
