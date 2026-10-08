/// <reference lib="deno.ns" />

// ดึงค่า Secrets ของ Telegram ที่เราตั้งค่าไว้ในขั้นตอนที่ 1
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

// Telegram จำกัดข้อความละ 4,096 ตัวอักษร จึงเว้นระยะไว้เล็กน้อย
const MAX_MESSAGE_LENGTH = 3900;

// เผื่อที่ว่างไว้ปิด entity (* หรือ _) เมื่อต้องตัดข้อความกลาง entity
const CUT_HEADROOM = 2;

// Telegram แนะนำไม่ให้ส่งถี่เกิน 1 ข้อความ/วินาที ต่อแชท
const MIN_SEND_INTERVAL_MS = 1000;
const RETRY_AFTER_FALLBACK_MS = 1250;

/**
 * หา marker ของ entity (ตัวหนา/ตัวเอียง) ที่ยังเปิดค้างอยู่ท้ายข้อความ
 * โดยข้ามอักขระที่ถูก escape ด้วย backslash
 */
function openEntityMarkers(text: string): string[] {
  const open = new Set<string>();

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '*' || char === '_') {
      if (open.has(char)) {
        open.delete(char);
      }
      else {
        open.add(char);
      }
    }
  }

  return [...open];
}

/** ตรวจว่าข้อความลงท้ายด้วย backslash ที่ยังไม่ถูกจับคู่หรือไม่ */
function endsWithDanglingEscape(text: string): boolean {
  let count = 0;

  for (let index = text.length - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    count += 1;
  }

  return count % 2 === 1;
}

/**
 * แบ่งข้อความ MarkdownV2 เป็นหลายข้อความให้ Telegram รับได้
 * โดยตัดที่ขอบย่อหน้าก่อน แล้วจึงตัดที่ขอบบรรทัด
 *
 * - ไม่ตัด escape pair (backslash + ตัวอักษร) กลางคัน
 * - ถ้าต้องตัดกลาง entity จะปิด entity ท้ายข้อความนี้
 *   แล้วเปิดใหม่ต้นข้อความถัดไป เพื่อให้ทุกส่วนเป็น MarkdownV2 ที่ถูกต้อง
 * - บรรทัดเดี่ยวยาวเกินลิมิตจะถูกหั่นเป็นหลายส่วนแทนการ throw
 */
function splitMessage(text: string, limit: number = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const chunks: string[] = [];
  let current = '';

  // ปิด entity ที่ค้างอยู่ แล้วเปิดใหม่ในข้อความถัดไป
  function flush(): void {
    if (current.length === 0) {
      return;
    }
    const open = openEntityMarkers(current);
    const markers = open.join('');
    chunks.push(current + markers);
    current = markers;
  }

  // ต่อหนึ่งบรรทัด (พร้อมตัวคั่น) โดยหั่นเองถ้ายาวเกิน
  function appendLine(line: string, suffix: string): void {
    const unit = line + suffix;

    if (current.length + unit.length <= limit - CUT_HEADROOM) {
      current += unit;
      return;
    }

    flush();

    if (current.length + unit.length <= limit - CUT_HEADROOM) {
      current += unit;
      return;
    }

    // บรรทัดเดียวยาวเกิน: หั่นเป็นส่วน ๆ โดยไม่ตัด escape pair
    let rest = line;
    while (rest.length > 0) {
      const capacity = limit - CUT_HEADROOM - current.length - (rest.length === line.length ? suffix.length : 0);
      let cut = Math.min(Math.max(capacity, 1), rest.length);

      if (cut > 1 && endsWithDanglingEscape(rest.slice(0, cut))) {
        cut -= 1;
      }

      current += rest.slice(0, cut);
      rest = rest.slice(cut);

      if (rest.length === 0) {
        current += suffix;
        return;
      }

      flush();
    }
  }

  // ต่อหนึ่งย่อหน้า โดยถ้าเกินลิมิตให้ไล่ต่อทีละบรรทัด
  function appendBlock(block: string): void {
    if (current.length + block.length <= limit - CUT_HEADROOM) {
      current += block;
      return;
    }

    flush();

    if (current.length + block.length <= limit - CUT_HEADROOM) {
      current += block;
      return;
    }

    const lines = block.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const suffix = index < lines.length - 1 ? '\n' : '';
      appendLine(lines[index] ?? '', suffix);
    }
  }

  const paragraphs = text.split('\n\n');
  for (let index = 0; index < paragraphs.length; index += 1) {
    const isLast = index === paragraphs.length - 1;
    appendBlock(isLast ? (paragraphs[index] ?? '') : `${paragraphs[index] ?? ''}\n\n`);
  }

  flush();
  return chunks;
}

/** อ่านค่า retry_after (วินาที) ที่ Telegram แนบมากับ 429 */
async function retryAfterMs(response: Response): Promise<number> {
  try {
    const body = await response.json();
    const seconds = Number(body?.parameters?.retry_after);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000 + 250;
    }
  }
  catch {
    // ใช้ค่า default ด้านล่าง
  }
  return RETRY_AFTER_FALLBACK_MS;
}

/** ส่งข้อความหนึ่งส่วนไปยัง Telegram */
async function sendChunk(telegramApiUrl: string, text: string): Promise<Response> {
  return await fetch(telegramApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'MarkdownV2', // เปิดใช้งานการจัดรูปแบบข้อความด้วย Markdown
    }),
  });
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
    let lastSentAt = 0;

    for (let index = 0; index < chunks.length; index += 1) {
      // เว้นจังหวะไม่ให้ถี่เกิน 1 ข้อความ/วินาที ต่อแชท
      if (lastSentAt !== 0) {
        const pause = MIN_SEND_INTERVAL_MS - (Date.now() - lastSentAt);
        if (pause > 0) {
          await new Promise(resolve => setTimeout(resolve, pause));
        }
      }

      let response = await sendChunk(telegramApiUrl, chunks[index] ?? '');

      // ถ้าโดน rate limit ให้รอตามที่ Telegram แจ้งแล้วลองอีกครั้ง
      if (response.status === 429) {
        await new Promise(resolve => setTimeout(resolve, await retryAfterMs(response)));
        response = await sendChunk(telegramApiUrl, chunks[index] ?? '');
      }

      lastSentAt = Date.now();

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
