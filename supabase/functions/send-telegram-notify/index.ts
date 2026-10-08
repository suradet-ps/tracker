/// <reference lib="deno.ns" />

// ดึงค่า Secrets ของ Telegram ที่เราตั้งค่าไว้ในขั้นตอนที่ 1
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Telegram จำกัดข้อความละ 4,096 ตัวอักษร จึงเว้นระยะไว้เล็กน้อย
const MAX_MESSAGE_LENGTH = 3900;

/**
 * แบ่งข้อความ MarkdownV2 เป็นหลายข้อความให้ Telegram รับได้
 * โดยตัดที่ขอบย่อหน้า (\n\n) ก่อน แล้วจึงตัดที่ขอบบรรทัด
 * เพื่อไม่ให้ตัด entity (ตัวหนา/ตัวเอียง) กลางคัน
 */
function splitMessage(text: string, limit: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  function flush(): void {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  }

  const paragraphs = text.split('\n\n');

  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index] ?? '';
    const isLast = index === paragraphs.length - 1;
    const block = isLast ? paragraph : `${paragraph}\n\n`;

    // ย่อหน้าเดียวยาวเกินลิมิต: ตัดเป็นรายบรรทัดแทน
    if (block.length > limit) {
      flush();
      for (const line of block.split('\n')) {
        const lineBlock = `${line}\n`;
        if (lineBlock.length > limit) {
          throw new Error('A single line exceeds the Telegram message length limit.');
        }
        if (current.length + lineBlock.length > limit) {
          flush();
        }
        current += lineBlock;
      }
      continue;
    }

    if (current.length + block.length > limit) {
      flush();
    }
    current += block;
  }

  flush();
  return chunks;
}

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

    // สร้าง URL ของ Telegram API โดยใช้ Token ที่ผ่านการตรวจสอบแล้ว
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

    // ดึงข้อมูล 'message' ที่ถูกส่งมาจากเว็บ Vue ของเรา
    const { message } = await req.json();
    if (!message) {
      throw new Error('Message text is required in the request body.');
    }

    // แบ่งข้อความยาวเกินลิมิตเป็นหลายส่วน แล้วส่งต่อเนื่องกัน
    const chunks = splitMessage(String(message));

    for (let index = 0; index < chunks.length; index++) {
      // ส่ง Request ไปยัง Telegram API
      const response = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: chunks[index],
          parse_mode: 'MarkdownV2', // เปิดใช้งานการจัดรูปแบบข้อความด้วย Markdown
        }),
      });

      // ตรวจสอบว่า Telegram ตอบกลับมาว่าสำเร็จหรือไม่
      if (!response.ok) {
        const errorBody = await response.json();
        console.error('Telegram API Error:', errorBody); // แสดง error ใน logs ของ function
        throw new Error(
          `Telegram API error (part ${index + 1}/${chunks.length}): ${errorBody.description}`,
        );
      }
    }

    // ส่งผลลัพธ์ว่าสำเร็จกลับไปให้เว็บ Vue
    const data = { status: 'ok', parts: chunks.length };
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
