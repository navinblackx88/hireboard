import http from "node:http";

/**
 * Stands in for api.openai.com/v1/chat/completions so the real OpenAI SDK code path is exercised.
 * Tests set `behaviour` to control what comes back and inspect `requests` to see what was sent.
 */
export type Behaviour =
  | { kind: "score"; score: number; strengths?: string[]; gaps?: string[]; summary?: string }
  | { kind: "error"; status: number }
  | { kind: "refusal" };

export function startMockOpenAI(port: number) {
  const state = { behaviour: { kind: "score", score: 82 } as Behaviour, requests: [] as Record<string, any>[] };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) { res.writeHead(404).end(); return; }
      const body = JSON.parse(raw);
      state.requests.push({ ...body, authorization: req.headers.authorization });
      const b = state.behaviour;
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
