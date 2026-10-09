/// <reference lib="deno.ns" />
import { sendTelegramMessage } from '../_shared/telegram.ts';

// ดึงค่า Secrets ของ Telegram ที่เราตั้งค่าไว้ในขั้นตอนที่ 1
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// เริ่มการทำงานของ Server Function
Deno.serve(async (req: Request): Promise<Response> => {
  // ตั้งค่า CORS Headers เพื่อให้เว็บ Vue ของเราเรียกใช้ฟังก์ชันนี้ได้
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // ตอบกลับสำหรับ preflight request (จำเป็นสำหรับเบราว์เซอร์)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ตรวจสอบว่าตั้งค่า Secrets ครบถ้วนหรือไม่
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      throw new Error('Telegram secrets (BOT_TOKEN or CHAT_ID) are not set in Supabase.');
    }

    // ดึงข้อมูล 'message' ที่ถูกส่งมาจากเว็บ Vue ของเรา
    const { message } = await req.json();
    if (!message) {
      throw new Error('Message text is required in the request body.');
    }

    // แบ่งข้อความยาวเกินลิมิตเป็นหลายส่วน แล้วส่งต่อเนื่องกัน
    const parts = await sendTelegramMessage({
      botToken: TELEGRAM_BOT_TOKEN,
      chatId: TELEGRAM_CHAT_ID,
      text: String(message),
      parseMode: 'MarkdownV2',
    });

    // ส่งผลลัพธ์ว่าสำเร็จกลับไปให้เว็บ Vue
    const data = { status: 'ok', parts };
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
  catch (error: unknown) {
    // กรณีเกิดข้อผิดพลาด ให้ส่ง error กลับไปให้เว็บ Vue
    const errorMessage = error instanceof Error
      ? error.message
      : String(error) || 'An unknown error occurred';

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
