import http from "node:http";

/**
 * Stands in for OpenAI (/v1/chat/completions), Anthropic (/v1/messages) and Gemini (models/…:generateContent),
 * so the real OpenAI, Anthropic and Google GenAI SDK code paths are exercised.
 * Tests set `behaviour` to control what comes back and inspect `requests` to see what was sent.
 */
export type Behaviour =
  | { kind: "score"; score: number; strengths?: string[]; gaps?: string[]; summary?: string }
  | { kind: "error"; status: number }
  | { kind: "refusal" }
  | { kind: "truncated" };

export function startMockOpenAI(port: number) {
  const state = { behaviour: { kind: "score", score: 82 } as Behaviour, requests: [] as Record<string, any>[] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const isClaude = req.url?.endsWith("/v1/messages");
      const isGemini = req.url?.includes(":generateContent");
      if (req.method !== "POST" || !(isClaude || isGemini || req.url?.endsWith("/chat/completions"))) { res.writeHead(404).end(); return; }
      const body = JSON.parse(raw);
      state.requests.push({ ...body, url: req.url, authorization: req.headers.authorization, apiKey: req.headers["x-api-key"], googApiKey: req.headers["x-goog-api-key"], anthropicVersion: req.headers["anthropic-version"] });
      const b = state.behaviour;
      if (isClaude) { claudeReply(res, body, b); return; }
      if (isGemini) { geminiReply(res, body, b); return; }
      if (b.kind === "error") { res.writeHead(b.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "mock upstream failure", type: "server_error" } })); return; }
      // Score derived from the resume so different candidates get different scores.
      const user = body.messages.find((m: { role: string }) => m.role === "user").content as string;
      const resume = /<resume>([\s\S]*)<\/resume>/.exec(user)?.[1] ?? "";
      const kw = (resume.match(/kubernetes|postgresql|typescript|aws/gi) ?? []).length;
      const message = b.kind === "refusal"
        ? { role: "assistant", content: null, refusal: "I can't help with that." }
        : { role: "assistant", refusal: null, content: JSON.stringify({
            score: b.score === -1 ? 40 + kw * 7 : b.score,
            summary: b.summary ?? "Strong backend match with relevant cloud experience.",
            strengths: b.strengths ?? ["TypeScript and Node.js APIs", "AWS microservices"],
            gaps: b.gaps ?? ["No Kubernetes in production"],
          }) };
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        id: "chatcmpl-mock", object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
        choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }));
    });
  });
  return new Promise<{ state: typeof state; close: () => Promise<void> }>((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ state, close: () => new Promise((r) => server.close(() => r())) })));
}

/** Anthropic Messages API response (structured output arrives as JSON in a text block). */
function claudeReply(res: http.ServerResponse, body: any, b: Behaviour) {
  if (b.kind === "error") {
    res.writeHead(b.status, { "Content-Type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock upstream failure" } }));
    return;
  }
  const user = body.messages.find((m: { role: string }) => m.role === "user").content as string;
  const resume = /<resume>([\s\S]*)<\/resume>/.exec(user)?.[1] ?? "";
  const kw = (resume.match(/kubernetes|postgresql|typescript|aws/gi) ?? []).length;
  const stop_reason = b.kind === "refusal" ? "refusal" : b.kind === "truncated" ? "max_tokens" : "end_turn";
  const content = b.kind === "score"
    ? [{ type: "text", text: JSON.stringify({
        score: b.score === -1 ? 40 + kw * 7 : b.score,
        summary: b.summary ?? "Strong backend match with relevant cloud experience.",
        strengths: b.strengths ?? ["TypeScript and Node.js APIs", "AWS microservices"],
        gaps: b.gaps ?? ["No Kubernetes in production"],
      }) }]
    : b.kind === "truncated" ? [{ type: "text", text: '{"score": 7' }] : [];
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    id: "msg_mock", type: "message", role: "assistant", model: body.model, content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  }));
}

/** Gemini generateContent response (structured output arrives as JSON text in the first candidate's part). */
function geminiReply(res: http.ServerResponse, body: any, b: Behaviour) {
  if (b.kind === "error") {
    res.writeHead(b.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { code: b.status, message: "mock upstream failure", status: "INTERNAL" } }));
    return;
  }
  const user = body.contents?.[0]?.parts?.[0]?.text ?? "";
  const resume = /<resume>([\s\S]*)<\/resume>/.exec(user)?.[1] ?? "";
  const kw = (resume.match(/kubernetes|postgresql|typescript|aws/gi) ?? []).length;
  const finishReason = b.kind === "refusal" ? "SAFETY" : b.kind === "truncated" ? "MAX_TOKENS" : "STOP";
  const text = b.kind === "score"
    ? JSON.stringify({
        score: b.score === -1 ? 40 + kw * 7 : b.score,
        summary: b.summary ?? "Strong backend match with relevant cloud experience.",
        strengths: b.strengths ?? ["TypeScript and Node.js APIs", "AWS microservices"],
        gaps: b.gaps ?? ["No Kubernetes in production"],
      })
    : b.kind === "truncated" ? '{"score": 7' : undefined;
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
    candidates: [{ content: { role: "model", parts: text ? [{ text }] : [] }, finishReason, index: 0 }],
    modelVersion: "gemini-test", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 },
  }));
}
