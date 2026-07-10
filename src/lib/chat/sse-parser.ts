/**
 * 极简 SSE 帧解析器
 * --------------------------------------------------------------
 * 用法：
 *   const reader = response.body.getReader();
 *   const parser = createSseParser();
 *   while (true) {
 *     const { value, done } = await reader.read();
 *     if (done) break;
 *     for (const ev of parser.feed(value)) {
 *       // 处理 ev.type / ev.data
 *     }
 *   }
 *
 * 不依赖 EventSource —— EventSource 不支持 POST，所以我们必须 fetch + 手解流。
 *
 * 帧格式（与 /api/chat 一致）：
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * 没拿到完整 \n\n 之前缓冲，拿到后 yield 一个 event。
 */

export interface SseEvent {
  type: string;
  data: string; // 原始 JSON 字符串；调用方负责 JSON.parse
}

export interface SseParser {
  feed(chunk: Uint8Array): SseEvent[];
  /** 流结束时，把还在 buffer 里的最后一帧（如果有）冲出来 */
  flush(): SseEvent[];
}

export function createSseParser(): SseParser {
  const decoder = new TextDecoder();
  let buffer = "";

  function drain(): SseEvent[] {
    const out: SseEvent[] = [];
    while (true) {
      const idx = buffer.indexOf("\n\n");
      if (idx === -1) break;
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseFrame(frame);
      if (ev) out.push(ev);
    }
    return out;
  }

  return {
    feed(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      return drain();
    },
    flush() {
      buffer += decoder.decode();
      const last = drain();
      if (buffer.trim().length > 0) {
        const ev = parseFrame(buffer);
        buffer = "";
        if (ev) last.push(ev);
      }
      return last;
    },
  };
}

function parseFrame(raw: string): SseEvent | null {
  let type = "";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith(":")) continue; // 空行或注释行
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (!type) return null;
  return { type, data: dataLines.join("\n") };
}
