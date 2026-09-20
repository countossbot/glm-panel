// src/app/v1/[...path]/route.ts
// Streams everything under <panel-url>/v1/* straight to the GLM-Free-API bridge
// on localhost:3001 — OpenAI (/v1/chat/completions, /v1/models) and Anthropic
// (/v1/messages) alike. SSE streaming is passed through untouched.
//
// CLIENT AUTH: enforced HERE at the proxy. If an auth key is configured in the
// admin panel (admin-config.json → authKey), clients must present it via
// "Authorization: Bearer <key>" or "x-api-key: <key>". With no key configured
// (default), access is open — any/no key is accepted. Either way the proxy
// injects the bridge's internal credential upstream, so "Waguri" never leaks
// to clients. Key changes apply on the next request — no restart.

import { BRIDGE_AUTH_TOKEN, authKeyState, providedClientKey } from "@/lib/zai-backend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND_URL = "http://localhost:3001";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, x-api-key, anthropic-version, Accept",
  "Access-Control-Max-Age": "86400",
};

const PASS_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "x-api-key",
  "anthropic-version",
  "accept",
  "user-agent",
];

interface Ctx {
  params: Promise<{ path?: string[] }>;
}

function responsesText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((p: any) => typeof p?.text === "string" ? p.text : "").join("");
}

function responsesMessages(input: unknown, instructions?: string) {
  const messages: Array<Record<string, unknown>> = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  if (typeof input === "string") return [...messages, { role: "user", content: input }];
  if (!Array.isArray(input)) return messages;
  for (const item of input as any[]) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.call_id, content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "") });
      continue;
    }
    if (item.type === "function_call") {
      messages.push({ role: "assistant", content: null, tool_calls: [{ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments ?? "" } }] });
      continue;
    }
    if (item.type === "message" && item.role === "tool") {
      messages.push({ role: "tool", tool_call_id: item.tool_call_id, content: responsesText(item.content) });
      continue;
    }
    let role = item.role;
    if (!role && item.type === "message") role = "user";
    if (item.type === "input_text") role = "user";
    if (item.type === "output_text") role = "assistant";
    if (role === "developer") role = "system";
    if (!["system", "user", "assistant"].includes(role)) continue;
    const text = typeof item.text === "string" ? item.text : responsesText(item.content);
    if (text) messages.push({ role, content: text });
  }
  return messages;
}

function responseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function proxyResponses(req: Request): Promise<Response> {
  const input = await req.json();
  const model = input.model || "x-preview-l";
  const messages = responsesMessages(input.input, input.instructions);
  if (!messages.length) {
    return new Response(JSON.stringify({ error: { message: "input is required", type: "invalid_request_error" } }), { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  }

  const chatBody: Record<string, unknown> = { model, messages, stream: true };
  if (Array.isArray(input.tools)) {
    chatBody.tools = input.tools.map((tool: any) => {
      if (tool?.type === "function" && tool.function) return tool;
      if (tool?.type === "function" && tool.name) {
        const { type, name, description, parameters, strict } = tool;
        return { type, function: { name, description, parameters, strict } };
      }
      return tool;
    });
  }
  if (input.reasoning?.effort) chatBody.reasoning_effort = input.reasoning.effort;
  if (typeof input.temperature === "number") chatBody.temperature = input.temperature;
  if (typeof input.max_output_tokens === "number") chatBody.max_tokens = input.max_output_tokens;

  const upstream = await fetch(`${BACKEND_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BRIDGE_AUTH_TOKEN}` },
    body: JSON.stringify(chatBody),
    cache: "no-store",
    signal: AbortSignal.timeout(3_600_000),
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", ...CORS_HEADERS } });
  }

  const responseId = `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const itemId = `${responseId}_item`;
  const createdAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let completed = false;
  let upstreamFailed = false;
  let upstreamFailureMessage = "";
  let upstreamFinished = false;
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => controller.enqueue(encoder.encode(responseEvent(event, data)));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const outputItem = { id: itemId, type: "message", status: "in_progress", role: "assistant", content: [] };
      const contentPart = { type: "output_text", annotations: [] };
      const functionCalls = new Map<number, { id: string; call_id: string; name: string; arguments: string; item: any; outputIndex: number }>();
      emit(controller, "response.created", { type: "response.created", response: { id: responseId, object: "response", created_at: createdAt, status: "in_progress", model, output: [] } });
      emit(controller, "response.in_progress", { type: "response.in_progress", response: { id: responseId, object: "response", status: "in_progress" } });
      let messageStarted = false;
      const finish = () => {
        if (completed) return;
        completed = true;
        if (upstreamFailed) {
          emit(controller, "response.failed", { type: "response.failed", response: { id: responseId, object: "response", created_at: createdAt, status: "failed", model, output: [], error: { code: "upstream_stream_error", message: upstreamFailureMessage || "upstream response stream failed" } } });
          controller.close();
          return;
        }
        if (fullText && messageStarted) {
          emit(controller, "response.output_text.done", { type: "response.output_text.done", text: fullText, response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, logprobs: [] });
          emit(controller, "response.content_part.done", { type: "response.content_part.done", response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: fullText, annotations: [] } });
          emit(controller, "response.output_item.done", { type: "response.output_item.done", response_id: responseId, output_index: 0, item: { ...outputItem, status: "completed", content: [{ type: "output_text", text: fullText, annotations: [] }] } });
        }
        const output: any[] = [];
        if (fullText && messageStarted) output.push({ id: itemId, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: fullText, annotations: [] }] });
        for (const call of functionCalls.values()) {
          emit(controller, "response.function_call_arguments.done", { type: "response.function_call_arguments.done", response_id: responseId, item_id: call.id, output_index: call.outputIndex, call_id: call.call_id, name: call.name, arguments: call.arguments });
          emit(controller, "response.output_item.done", { type: "response.output_item.done", response_id: responseId, output_index: call.outputIndex, item: { ...call.item, status: "completed", arguments: call.arguments } });
          output.push({ ...call.item, status: "completed", arguments: call.arguments });
        }
        emit(controller, "response.completed", { type: "response.completed", response: { id: responseId, object: "response", created_at: createdAt, status: "completed", model, output } });
        controller.close();
      };
      try {
        const reader = upstream.body!.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(String.fromCharCode(10));
          buffer = lines.pop() ?? "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let chunk: any;
            try { chunk = JSON.parse(data); } catch { continue; }
            if (chunk?.error) {
              upstreamFailed = true;
              upstreamFailureMessage = typeof chunk.error?.message === "string" ? chunk.error.message : "upstream response stream failed";
              continue;
            }
            const choice = chunk?.choices?.[0];
            if (choice?.finish_reason != null) upstreamFinished = true;
            const delta = choice?.delta?.content;
            if (typeof delta === "string" && delta) {
              if (!messageStarted) {
                messageStarted = true;
                emit(controller, "response.output_item.added", { type: "response.output_item.added", response_id: responseId, output_index: 0, item: outputItem });
                emit(controller, "response.content_part.added", { type: "response.content_part.added", response_id: responseId, item_id: itemId, output_index: 0, content_index: 0, part: contentPart });
              }
              fullText += delta;
              emit(controller, "response.output_text.delta", { type: "response.output_text.delta", delta, response_id: responseId, item_id: itemId, output_index: 0, content_index: 0 });
            }
            const toolCalls = Array.isArray(choice?.delta?.tool_calls) ? choice.delta.tool_calls : [];
            for (const tc of toolCalls) {
              const index = Number(tc.index ?? 0);
              let call = functionCalls.get(index);
              if (!call) {
                const callId = tc.id || `call_${crypto.randomUUID().replaceAll("-", "")}`;
                const name = tc.function?.name || "";
                const functionItemId = `${responseId}_fc_${index}`;
                const item = { id: functionItemId, type: "function_call", status: "in_progress", call_id: callId, name, arguments: "" };
                call = { id: functionItemId, call_id: callId, name, arguments: "", item, outputIndex: index };
                functionCalls.set(index, call);
                emit(controller, "response.output_item.added", { type: "response.output_item.added", response_id: responseId, output_index: index, item });
              }
              const args = typeof tc.function?.arguments === "string" ? tc.function.arguments : "";
              if (args) {
                call.arguments += args;
                emit(controller, "response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", response_id: responseId, item_id: call.id, output_index: index, call_id: call.call_id, delta: args });
              }
            }
            if (choice?.finish_reason != null) finish();
          }
        }
        // A normal upstream EOF is only successful if we actually received
        // a usable completion stream. An empty stream is not a completed
        // Responses response and must not be disguised as response.completed.
        if (!completed) {
          if (!upstreamFinished && !fullText && functionCalls.size === 0 && !upstreamFailed) {
            upstreamFailed = true;
            upstreamFailureMessage = "upstream stream ended without a completion event";
          }
          finish();
        }
      } catch (error) {
        if (!completed) {
          emit(controller, "response.failed", { type: "response.failed", response: { id: responseId, object: "response", created_at: createdAt, status: "failed", model, output: [], error: { code: "upstream_stream_error", message: error instanceof Error ? error.message : String(error) } } });
          completed = true;
          controller.close();
        }
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", ...CORS_HEADERS } });
}

async function proxy(req: Request, ctx: Ctx): Promise<Response> {
  const { path = [] } = await ctx.params;
  const incoming = new URL(req.url);
  const endpoint = path.join("/");

  if (req.method === "POST" && endpoint === "responses") {
    return proxyResponses(req);
  }

  const target = `${BACKEND_URL}/v1/${endpoint}${incoming.search}`;

  // ---- client-facing auth (proxy layer) ----
  const auth = authKeyState();
  if (auth.mode === "key" && providedClientKey(req.headers) !== auth.key) {
    return new Response(
      JSON.stringify({
        error: {
          message:
            "Invalid or missing API key. Present the configured key via 'Authorization: Bearer <key>' or 'x-api-key: <key>'.",
          type: "authentication_error",
          code: "invalid_api_key",
        },
      }),
      { status: 401, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  const headers = new Headers();
  for (const h of PASS_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // The bridge's own credential is an internal detail — always present it
  // upstream regardless of what the client sent.
  headers.set("authorization", `Bearer ${BRIDGE_AUTH_TOKEN}`);

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
      // NOTE: this signal spans the WHOLE fetch — including body streaming.
      // A 10-minute cap used to abort long thinking+answer streams mid-flight
      // (client sees "Response truncated — stream ended before completion"),
      // so give GLM thinking mode a full hour before giving up.
      signal: AbortSignal.timeout(3_600_000),
    });

    const respHeaders = new Headers();
    for (const h of ["content-type", "cache-control", "x-request-id"]) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: {
          message: `GLM bridge backend unreachable at ${BACKEND_URL} — start it from the admin panel. (${e instanceof Error ? e.message : String(e)})`,
          type: "bridge_proxy_error",
          code: "backend_unreachable",
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }
}

export async function GET(req: Request, ctx: Ctx) {
  return proxy(req, ctx);
}

export async function POST(req: Request, ctx: Ctx) {
  return proxy(req, ctx);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
