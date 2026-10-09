/// <reference lib="deno.ns" />

/**
 * Shared Telegram Bot API sender for the Tracker edge functions.
 *
 * Handles the two constraints the Bot API imposes on sendMessage:
 *   - 4,096 characters per message (text is split, MarkdownV2 entities are
 *     closed and reopened across parts)
 *   - roughly one message per second per chat (sends are paced, and a 429
 *     response is retried after the `retry_after` Telegram returns)
 */

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
function splitMarkdownMessage(text: string, limit: number = MAX_MESSAGE_LENGTH): string[] {
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

/**
 * แบ่งข้อความ plain text เป็นหลายข้อความ โดยตัดที่ขอบบรรทัดก่อน
 * และหั่นเฉพาะบรรทัดที่ยาวเกินลิมิต (ไม่ต้องดูแล entity)
 */
function splitPlainMessage(text: string, limit: number = MAX_MESSAGE_LENGTH): string[] {
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

  for (const line of text.split('\n')) {
    const unit = current.length === 0 ? line : `\n${line}`;

    if (current.length + unit.length <= limit) {
      current += unit;
      continue;
    }

    flush();

    if (line.length <= limit) {
      current = line;
      continue;
    }

    let rest = line;
    while (rest.length > 0) {
      current = rest.slice(0, limit);
      rest = rest.slice(limit);
      flush();
    }
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
async function sendChunk(
  telegramApiUrl: string,
  chatId: string,
  text: string,
  parseMode?: 'MarkdownV2',
): Promise<Response> {
  return await fetch(telegramApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    }),
  });
}

/**
 * Send `text` to one Telegram chat, splitting long messages and pacing the
 * sends. Returns the number of parts sent.
 *
 * @throws when Telegram rejects a part after the rate-limit retry.
 */
export async function sendTelegramMessage(options: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: 'MarkdownV2';
}): Promise<number> {
  const { botToken, chatId, text, parseMode } = options;
  const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const chunks = parseMode === 'MarkdownV2' ? splitMarkdownMessage(text) : splitPlainMessage(text);

  let lastSentAt = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    // เว้นจังหวะไม่ให้ถี่เกิน 1 ข้อความ/วินาที ต่อแชท
    if (lastSentAt !== 0) {
      const pause = MIN_SEND_INTERVAL_MS - (Date.now() - lastSentAt);
      if (pause > 0) {
        await new Promise(resolve => setTimeout(resolve, pause));
      }
    }

    let response = await sendChunk(telegramApiUrl, chatId, chunks[index] ?? '', parseMode);

    // ถ้าโดน rate limit ให้รอตามที่ Telegram แจ้งแล้วลองอีกครั้ง
    if (response.status === 429) {
      const waitMs = await retryAfterMs(response);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      response = await sendChunk(telegramApiUrl, chatId, chunks[index] ?? '', parseMode);
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

  return chunks.length;
}
