// Spike: verify native tool calling on Nebius Token Factory + Nemotron before
// building Sift's agent loop, where the model decides on its own whether to
// call search_site / fetch_page, reads the results, maybe searches again, and
// only then answers. Checked live rather than assumed:
//   - tool calls come back parsed in message.tool_calls, not as raw text
//   - streamed tool-call arguments arrive in fragments that must be joined
//   - multi-round conversations with role: "tool" messages are accepted
//   - which way of forcing a final answer at the round cap actually works
//   - latency, prompt tokens and prefix caching at a realistic page size
// Both tools are stubbed against a fictional site (loomkit.example), so every
// expected answer is only knowable from the page or a stubbed tool result,
// never from the model's own knowledge. No Tavily calls are made.
//
// Run with:
//   npm run test:tools                         # default Nemotron model
//   npm run test:tools -- <model-id> [...]     # compare specific models
//   npm run test:tools -- --only=<case-id>     # one case, or a group: --only=force compares force strategies
//   npm run test:tools -- --repeat=<n>         # run each case n times, for flaky behavior
// Requires NEBIUS_API_KEY in .env (see .env.example). Exits 1 on any FAIL.

const BASE_URL = "https://api.tokenfactory.nebius.com/v1";
const REQUEST_TIMEOUT_MS = 180_000;
// Round cap from the agent design: once the model has used tools this many
// rounds, the next call is forced to answer.
const MAX_TOOL_ROUNDS = 3;

const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error("Missing NEBIUS_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

// Same preference order as test-nebius.mjs and src/background/nebius/modelDiscovery.ts.
const NEMOTRON_CANDIDATES = [
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  "nvidia/nemotron-3-super-120b-a12b",
];

// ---------------------------------------------------------------------------
// Tools

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_site",
      description:
        "Search the site the user is viewing. Returns titles, URLs and short snippets. The site is fixed, so pass only the query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "A self-contained search query. Resolve references from the conversation: use names, not 'she' or 'it'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_page",
      description: "Read the full text of a page returned by search_site, when its snippet isn't enough.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "A URL exactly as search_site returned it." },
        },
        required: ["url"],
      },
    },
  },
];
const REQUIRED_ARGS = Object.fromEntries(TOOLS.map((t) => [t.function.name, t.function.parameters.required]));

// Ways to force the final answer once the round cap is hit. Verified on
// Nemotron 3 Nano (2026-09-23, 5 runs each): with tool_choice "none", or with
// tools omitted, the model still writes a tool call, which comes back as raw
// <tool_call> markup in content every time. Only omitting tools plus a nudge
// message gave a clean answer (5/5). The nudge is a transient user message for
// that one call, never kept in history. The two rejected strategies only run
// with --only=force, to recheck them on another model.
const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it.";
const FORCE_STRATEGIES = {
  "tool-choice-none": (messages) => ({ messages, params: { tools: TOOLS, tool_choice: "none" } }),
  "omit-tools": (messages) => ({ messages, params: {} }),
  "omit-tools+nudge": (messages) => ({
    messages: [...messages, { role: "user", content: FORCE_NUDGE }],
    params: {},
  }),
};
const DEFAULT_FORCE_STRATEGY = "omit-tools+nudge";

// Tool-call syntax that should have been parsed into message.tool_calls. In
// content it would render raw markup as the answer; in the reasoning of a
// round with no tool_calls it points at a missed server-side parse.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i;
const TOOL_JSON = /"name"\s*:\s*"(search_site|fetch_page)"/;

// ---------------------------------------------------------------------------
// Fixture: a fictional site, so answers can't come from the model's own knowledge

const PAGE = {
  title: "Introducing Loomkit 2.0",
  url: "https://loomkit.example/blog/introducing-loomkit-2",
  content: [
    "Introducing Loomkit 2.0",
    "By Dana Reyes, co-founder. Published March 3, 2026.",
    "",
    "Loomkit started in 2019 as a side project between Dana Reyes and Theo Marsh, two engineers tired of stitching five tools together to plan a sprint. Today we're releasing Loomkit 2.0, our biggest update since launch.",
    "",
    "What's new in 2.0:",
    "- Timeline view: drag tasks across weeks and see dependencies as arrows.",
    "- Offline mode: every board is cached locally and syncs when you reconnect.",
    "- Guest seats: invite clients to a single board without giving them access to your workspace.",
    "",
    "Loomkit 2.0 is rolling out to all workspaces over the next two weeks. Existing boards migrate automatically.",
    "",
    "Thanks to the 1,200 beta testers who filed over 3,000 bug reports during the preview.",
  ].join("\n"),
};

const PRICING_URL = "https://loomkit.example/pricing";
const PRICING_TEXT =
  "Loomkit pricing. Free: up to 3 boards and 2 members. Pro: $17.50 per user per month billed annually, or $21 billed monthly. Business: custom pricing with SSO and audit logs.";
const PRICE = /17\.50/;
const MADE_UP_PRICE = /\$\s?\d/;
const PRICE_QUESTION = "How much does the Loomkit Pro plan cost?";

// Canned search_site results.
const RESULTS = {
  pricing: [{ title: "Pricing | Loomkit", url: PRICING_URL, content: PRICING_TEXT }],
  // Same page, but the snippet leaves the price out: only fetch_page finds it.
  pricingNoPrice: [
    {
      title: "Pricing | Loomkit",
      url: PRICING_URL,
      content: "Compare Loomkit's Free, Pro and Business plans and pick the right fit for your team.",
    },
  ],
  authorPosts: [
    {
      title: "Why we built offline mode first | Loomkit",
      url: "https://loomkit.example/blog/offline-mode-first",
      content: "Dana Reyes on why offline mode shipped before every other 2.0 feature.",
    },
    {
      title: "Hiring our first designer | Loomkit",
      url: "https://loomkit.example/blog/first-designer",
      content: "Dana Reyes on what she looked for in Loomkit's first design hire.",
    },
  ],
  unrelated: [
    {
      title: "Changelog | Loomkit",
      url: "https://loomkit.example/changelog",
      content: "Build notes for recent releases: board rendering fixes and notification timing.",
    },
  ],
};

// fetch_page contents: each result's snippet, except the full pricing page.
const FULL_PAGES = {
  ...Object.fromEntries(Object.values(RESULTS).flat().map((r) => [r.url, r.content])),
  [PRICING_URL]: PRICING_TEXT,
};

// ---------------------------------------------------------------------------
// Cases. `search(query, state)` stubs search_site; `check(run, c)` adds the
// case's own checks on top of the protocol checks every case gets.

const CASES = [
  {
    id: "loop",
    title: "Off-page question: search_site, then answer from the result",
    question: PRICE_QUESTION,
    search: () => RESULTS.pricing,
    check(run, c) {
      const first = run.rounds[0];
      c.must(
        first.toolCalls.some((tc) => tc.name === "search_site"),
        "called search_site for an off-page question",
        `answered directly: ${preview(first.content)}`,
      );
      c.must(PRICE.test(run.answer), "final answer uses the tool result ($17.50)", preview(run.answer));
    },
  },
  {
    id: "on-page",
    title: "On-page question: answer without tools",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    check(run, c) {
      const used = run.state.queries.length + run.state.fetchedUrls.length;
      c.should(
        used === 0,
        "answered without calling tools",
        `over-searched: ${JSON.stringify(run.state.queries.map((q) => q.query))}`,
      );
      c.must(/1,?200/.test(run.answer), "answer comes from the page (1,200 testers)", preview(run.answer));
    },
  },
  {
    id: "follow-up",
    title: 'Follow-up with a pronoun: the query resolves "she"',
    history: [
      { role: "user", content: "Who wrote this post?" },
      { role: "assistant", content: "Dana Reyes, Loomkit's co-founder, wrote this post." },
    ],
    question: "What else has she written on this site?",
    search: (query) => (/dana|reyes/i.test(query) ? RESULTS.authorPosts : RESULTS.unrelated),
    check(run, c) {
      const [first] = run.state.queries;
      c.must(Boolean(first), "called search_site", `answered directly: ${preview(run.answer)}`);
      if (first) {
        c.should(
          /dana|reyes/i.test(first.query),
          'first query names the author instead of "she"',
          `query: ${JSON.stringify(first.query)}`,
        );
      }
      c.should(/offline mode|designer/i.test(run.answer), "answer lists her other posts", preview(run.answer));
    },
  },
  {
    id: "refine",
    title: "First search comes back empty: model searches again with a new query",
    question: PRICE_QUESTION,
    search: (_query, state) => (state.searchRounds === 1 ? [] : RESULTS.pricing),
    check(run, c) {
      const { queries } = run.state;
      const firstRound = queries[0]?.round;
      const retries = queries.filter((q) => q.round > firstRound);
      c.should(
        retries.length > 0,
        "searched again after empty results",
        `${queries.length ? "gave up after one search round" : "never searched"}: ${preview(run.answer)}`,
      );
      if (retries.length) {
        const tried = new Set(queries.filter((q) => q.round === firstRound).map((q) => normalize(q.query)));
        c.should(
          retries.some((q) => !tried.has(normalize(q.query))),
          "retry used a different query",
          `repeated ${JSON.stringify(retries[0].query)}`,
        );
      }
      c.should(PRICE.test(run.answer), "final answer uses the retry's result ($17.50)", preview(run.answer));
      c.info("queries", JSON.stringify(queries.map((q) => q.query)));
    },
  },
  {
    id: "fetch",
    title: "Snippet lacks the answer: fetch_page on a result URL",
    question: PRICE_QUESTION,
    search: () => RESULTS.pricingNoPrice,
    check(run, c) {
      const { fetchedUrls, inventedUrls, allowedUrls } = run.state;
      const fetched = fetchedUrls.some((url) => allowedUrls.has(url));
      c.should(fetched, "called fetch_page when the snippet lacked the answer", `answer: ${preview(run.answer)}`);
      c.should(
        inventedUrls.length === 0,
        "fetch_page only used URLs from search results",
        `made up: ${JSON.stringify(inventedUrls)}`,
      );
      if (fetched) {
        c.must(PRICE.test(run.answer), "final answer uses the fetched page ($17.50)", preview(run.answer));
      } else {
        c.should(!MADE_UP_PRICE.test(run.answer), "without fetching, doesn't make up a price", preview(run.answer));
      }
    },
  },
  {
    id: "stream",
    title: "Same loop, streamed: tool-call arguments joined from deltas",
    question: PRICE_QUESTION,
    search: () => RESULTS.pricing,
    stream: true,
    check(run, c) {
      c.must(
        run.rounds.some((r) => r.toolCalls.length),
        "tool call assembled from streamed deltas",
        `answered directly: ${preview(run.answer)}`,
      );
      const fragments = run.rounds.flatMap((r) => r.streamInfo.argFragments);
      if (fragments.length) {
        c.info("argument fragments per tool call", `${fragments.join(", ")} (above 1 means deltas must be joined by index)`);
      }
      const last = run.rounds.at(-1);
      c.should(
        last.streamInfo.contentDeltas > 1,
        "final answer streamed in several deltas",
        `${last.streamInfo.contentDeltas} delta(s)`,
      );
      c.should(run.rounds.every((r) => r.usage), "usage reported (stream_options.include_usage)", "missing on some rounds");
      c.must(PRICE.test(run.answer), "final answer uses the tool result ($17.50)", preview(run.answer));
    },
  },
  ...Object.keys(FORCE_STRATEGIES).map((strategy) => ({
    id: `force:${strategy}`,
    title: `Round cap hit: force the final answer via ${strategy}`,
    question: PRICE_QUESTION,
    search: () => [],
    maxToolRounds: 1,
    forceStrategy: strategy,
    optIn: strategy !== DEFAULT_FORCE_STRATEGY,
    check(run, c) {
      const forced = run.rounds.find((r) => r.forced);
      c.should(Boolean(forced), "reached the forced final call", "model answered before the cap, so nothing was forced");
      if (forced) {
        c.should(
          !MADE_UP_PRICE.test(run.answer),
          "forced answer admits it found nothing (no made-up price)",
          preview(run.answer),
        );
      }
    },
  })),
  {
    id: "big-page",
    title: "Realistic page size (~100K chars): latency, tokens, caching",
    page: padPage(PAGE, 100_000),
    question: PRICE_QUESTION,
    search: () => RESULTS.pricing,
    check(run, c) {
      c.must(PRICE.test(run.answer), "final answer uses the tool result ($17.50)", preview(run.answer));
    },
  },
];

// ---------------------------------------------------------------------------
// Agent loop

async function runLoop(model, testCase) {
  const messages = [
    { role: "system", content: systemPrompt(testCase.page ?? PAGE) },
    ...(testCase.history ?? []),
    { role: "user", content: testCase.question },
  ];
  const state = { searchRounds: 0, queries: [], allowedUrls: new Set(), fetchedUrls: [], inventedUrls: [] };
  const rounds = [];
  const maxToolRounds = testCase.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const send = testCase.stream ? chatStream : chat;
  const forceStrategy = testCase.forceStrategy ?? DEFAULT_FORCE_STRATEGY;
  const done = (fields) => ({ rounds, state, answer: null, error: null, ...fields });

  for (let round = 1; ; round++) {
    const forced = round > maxToolRounds;
    const call = forced ? FORCE_STRATEGIES[forceStrategy](messages) : { messages, params: { tools: TOOLS } };
    let result;
    try {
      result = await send(model, call.messages, call.params);
    } catch (error) {
      return done({ error: `round ${round}${forced ? ` (forced via ${forceStrategy})` : ""}: ${error.message}` });
    }
    rounds.push({ round, forced, forceMode: forced ? forceStrategy : null, ...result });

    if (!result.toolCalls.length) return done({ answer: result.content });
    if (forced) return done({ error: `round ${round}: model still called tools on the forced final call` });

    // Echo the assistant turn without its reasoning, the same shape the real
    // handler will keep in history.
    messages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argsText },
      })),
    });
    if (result.toolCalls.some((tc) => tc.name === "search_site")) state.searchRounds++;
    for (const tc of result.toolCalls) {
      const output = tc.problems.length
        ? { error: `Invalid tool call: ${tc.problems.join("; ")}` }
        : runTool(testCase, state, tc, round);
      messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(output) });
    }
  }
}

function runTool(testCase, state, tc, round) {
  if (tc.name === "search_site") {
    state.queries.push({ round, query: tc.args.query });
    const results = testCase.search(tc.args.query, state);
    for (const r of results) state.allowedUrls.add(r.url);
    return { results };
  }
  // fetch_page: the allowlist rule the real handler will enforce. Only URLs a
  // search_site call returned, never one the model (or injected page text) made up.
  state.fetchedUrls.push(tc.args.url);
  if (!state.allowedUrls.has(tc.args.url)) {
    state.inventedUrls.push(tc.args.url);
    return { error: "fetch_page only accepts URLs returned by search_site." };
  }
  return { url: tc.args.url, content: FULL_PAGES[tc.args.url] ?? "" };
}

function systemPrompt(page) {
  const site = new URL(page.url).hostname;
  return [
    `You answer questions about the web page the user is viewing on ${site}.`,
    "Answer from the page content below whenever it covers the question.",
    `If it doesn't (or only covers part of it), call search_site to search ${site}. If the results don't help, search again with a better query.`,
    "If a result's snippet isn't enough, call fetch_page with that result's URL to read the page in full.",
    "Never answer from outside knowledge. If neither the page nor the search results cover the question, say so.",
    "",
    `Page title: ${page.title}`,
    `Page URL: ${page.url}`,
    "Page content:",
    page.content,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Nebius client

function postChat(body) {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function chat(model, messages, params) {
  const started = performance.now();
  const res = await postChat({ model, messages, ...params });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /chat/completions failed: ${res.status} ${text}`);
  }
  const body = JSON.parse(text);
  const choice = body.choices[0];
  const message = choice.message;
  return {
    ms: performance.now() - started,
    finishReason: choice.finish_reason,
    content: message.content ?? "",
    ...reasoningOf(message),
    toolCalls: (message.tool_calls ?? []).map((tc) =>
      inspectToolCall({ id: tc.id, type: tc.type, name: tc.function?.name, args: tc.function?.arguments }),
    ),
    usage: body.usage ?? null,
    raw: message,
  };
}

async function chatStream(model, messages, params) {
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const res = await postChat({ model, messages, ...params, stream: true, stream_options: { include_usage: true } });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST /chat/completions (stream) failed: ${res.status} ${text}`);
  }

  let content = "";
  let reasoning = "";
  let reasoningField = null;
  let finishReason = null;
  let usage = null;
  const calls = [];
  const streamInfo = { contentDeltas: 0, firstReasoningMs: null, firstToolCallMs: null, firstContentMs: null, argFragments: [] };

  function handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice("data:".length).trim();
    if (data === "[DONE]") return;

    let chunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return;
    }
    if (chunk.error) throw new Error(`stream error: ${JSON.stringify(chunk.error)}`);
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta ?? {};

    const r = reasoningOf(delta);
    if (r.reasoning) {
      reasoning += r.reasoning;
      reasoningField ??= r.reasoningField;
      streamInfo.firstReasoningMs ??= elapsed();
    }
    if (delta.content) {
      content += delta.content;
      streamInfo.contentDeltas++;
      streamInfo.firstContentMs ??= elapsed();
    }
    // Tool calls stream as fragments keyed by index: id and name usually come
    // first, then the arguments JSON in pieces that only parse once joined.
    for (const part of delta.tool_calls ?? []) {
      streamInfo.firstToolCallMs ??= elapsed();
      const slot = (calls[part.index ?? 0] ??= { id: "", type: "", name: "", args: "", fragments: 0 });
      if (part.id) slot.id = part.id;
      if (part.type) slot.type = part.type;
      if (part.function?.name) slot.name += part.function.name;
      if (part.function?.arguments) {
        slot.args += part.function.arguments;
        slot.fragments++;
      }
    }
  }

  // A data: payload can be split across reads (see nebius/client.ts), so the
  // trailing partial line carries over to the next read.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach((line) => handleLine(line));
  }
  (buffer + decoder.decode()).split("\n").forEach((line) => handleLine(line));

  const present = calls.filter(Boolean);
  streamInfo.argFragments = present.map((call) => call.fragments);
  return {
    ms: elapsed(),
    finishReason,
    content,
    reasoning,
    reasoningField,
    toolCalls: present.map(inspectToolCall),
    usage,
    streamInfo,
  };
}

// Nebius's Nemotron returns `reasoning`; other OpenAI-compatible wrappers use
// `reasoning_content`. Works on a full message and on a stream delta.
function reasoningOf(source) {
  if (source.reasoning) return { reasoning: source.reasoning, reasoningField: "reasoning" };
  if (source.reasoning_content) return { reasoning: source.reasoning_content, reasoningField: "reasoning_content" };
  return { reasoning: "", reasoningField: null };
}

// Normalizes one tool call and lists everything the agent handler would have
// to defend against.
function inspectToolCall({ id, type, name, args: rawArgs }) {
  const problems = [];
  if (!id) problems.push("missing id");
  if (type && type !== "function") problems.push(`type is ${JSON.stringify(type)}`);
  if (!REQUIRED_ARGS[name]) problems.push(`unknown tool ${JSON.stringify(name)}`);

  const argsWereObject = typeof rawArgs === "object" && rawArgs !== null;
  const argsText = argsWereObject ? JSON.stringify(rawArgs) : String(rawArgs ?? "");
  let args = null;
  try {
    args = JSON.parse(argsText);
  } catch {
    // reported below
  }
  if (!args || typeof args !== "object") {
    problems.push(`arguments aren't a JSON object: ${clip(argsText, 120)}`);
  } else {
    for (const key of REQUIRED_ARGS[name] ?? []) {
      if (typeof args[key] !== "string" || !args[key].trim()) problems.push(`missing "${key}" argument`);
    }
  }
  return { id, name, argsText, args, argsWereObject, problems };
}

async function listModels() {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`GET /models failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data.map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Checks and output

function makeChecks() {
  const results = [];
  const add = (status, label, detail) => results.push({ status, label, detail });
  return {
    results,
    must: (ok, label, detail) => add(ok ? "PASS" : "FAIL", label, ok ? null : detail),
    should: (ok, label, detail) => add(ok ? "PASS" : "WARN", label, ok ? null : detail),
    info: (label, detail) => add("INFO", label, detail),
  };
}

// Protocol checks every case gets, on top of its own.
function checkProtocol(run, c) {
  c.must(!run.error, "loop completed", run.error);

  const toolRounds = run.rounds.filter((r) => r.toolCalls.length);
  const toolCalls = toolRounds.flatMap((r) => r.toolCalls);
  if (toolCalls.length) {
    const problems = toolCalls.flatMap((tc) => tc.problems.map((p) => `${tc.name ?? "?"}: ${p}`));
    c.must(!problems.length, "tool calls well-formed (id, known name, JSON object args)", problems.join("; "));
    c.should(
      !toolCalls.some((tc) => tc.argsWereObject),
      "arguments arrive as a JSON string",
      "got an object, so parse defensively",
    );
    const reasons = [...new Set(toolRounds.map((r) => r.finishReason))];
    c.should(
      reasons.length === 1 && reasons[0] === "tool_calls",
      'finish_reason is "tool_calls" on tool rounds',
      `got ${JSON.stringify(reasons)}, so key the loop off tool_calls, not finish_reason`,
    );
    const widest = Math.max(...toolRounds.map((r) => r.toolCalls.length));
    if (widest > 1) c.info("parallel tool calls", `${widest} in one round, so answer every tool_call_id`);
  }

  const leaked = run.rounds.filter((r) => TOOL_MARKUP.test(r.content) || TOOL_JSON.test(r.content));
  c.must(!leaked.length, "no tool-call syntax leaked into content", leaked.map((r) => preview(r.content)).join(" | "));
  const unparsed = run.rounds.filter((r) => !r.toolCalls.length && TOOL_MARKUP.test(r.reasoning));
  c.should(
    !unparsed.length,
    "no unparsed tool-call markup in reasoning",
    unparsed.map((r) => preview(r.reasoning)).join(" | "),
  );

  if (!run.error) c.must(Boolean(run.answer.trim()), "ended with a non-empty answer", preview(run.answer));
}

function printRun(run) {
  for (const r of run.rounds) {
    const tags = [seconds(r.ms), `finish=${r.finishReason}`, formatUsage(r.usage)];
    if (r.forced) tags.push(`forced: ${r.forceMode}`);
    console.log(`  r${r.round}  ${tags.join("  ")}`);
    if (r.streamInfo) {
      const s = r.streamInfo;
      console.log(
        `      first reasoning ${seconds(s.firstReasoningMs)}, first tool call ${seconds(s.firstToolCallMs)}, first content ${seconds(s.firstContentMs)}, ${s.contentDeltas} content deltas`,
      );
    }
    for (const tc of r.toolCalls) console.log(`      -> ${tc.name}(${tc.argsText})`);
    if (r.content.trim()) {
      console.log(`      ${r.toolCalls.length ? "text alongside tool calls" : "answer"}: ${preview(r.content, 240)}`);
    }
  }
  if (run.error) console.log(`  error: ${run.error}`);
}

function printRawMessage(message) {
  const shown = { ...message };
  for (const key of ["reasoning", "reasoning_content"]) {
    if (typeof shown[key] === "string") shown[key] = clip(shown[key], 200);
  }
  console.log("  raw tool-call message (reasoning clipped):");
  console.log(JSON.stringify(shown, null, 2).replace(/^/gm, "    "));
}

function printChecks(results) {
  for (const r of results) {
    console.log(`  ${r.status.padEnd(4)}  ${r.label}${r.detail ? `: ${r.detail}` : ""}`);
  }
}

function printModelNotes(runs) {
  const rounds = runs.flatMap((run) => run.rounds);
  const fields = [...new Set(rounds.map((r) => r.reasoningField).filter(Boolean))];
  const cached = rounds.map((r) => r.usage?.prompt_tokens_details?.cached_tokens).filter((n) => n != null);
  console.log(`\n  reasoning field: ${fields.join(", ") || "none seen"}`);
  console.log(
    `  prefix caching: ${cached.length ? `cached_tokens reported, max ${Math.max(...cached)}` : "cached_tokens never reported"}`,
  );
}

function formatUsage(usage) {
  if (!usage) return "usage n/a";
  const parts = [`in ${usage.prompt_tokens}`, `out ${usage.completion_tokens}`];
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  if (reasoningTokens != null) parts.push(`reasoning ${reasoningTokens}`);
  parts.push(`cached ${usage.prompt_tokens_details?.cached_tokens ?? "n/a"}`);
  return parts.join(", ");
}

function seconds(ms) {
  return ms == null ? "n/a" : `${(ms / 1000).toFixed(1)}s`;
}

function preview(text, max = 160) {
  return text ? JSON.stringify(clip(text, max)) : "(empty)";
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function normalize(query) {
  return query.trim().toLowerCase();
}

// Pads the fixture to a realistic article size (Sift caps extraction at 120K
// chars) with release notes that can't answer any of the questions.
function padPage(page, targetChars) {
  const lines = [page.content, "", "Release notes archive:"];
  let length = lines.join("\n").length;
  for (let build = 1; length < targetChars; build++) {
    const line = `Build 1.${build}: fixed board rendering glitches, tuned keyboard shortcuts and adjusted notification timing for workspace region ${build % 12}.`;
    lines.push(line);
    length += line.length + 1;
  }
  return { ...page, content: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Main

const cliArgs = process.argv.slice(2);
const only = cliArgs.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const repeat = Number(cliArgs.find((a) => a.startsWith("--repeat="))?.slice("--repeat=".length) ?? 1);
const requestedModels = cliArgs.filter((a) => !a.startsWith("--"));

if (!Number.isInteger(repeat) || repeat < 1) {
  console.error("--repeat must be a positive integer.");
  process.exit(1);
}
const cases = only
  ? CASES.filter((testCase) => testCase.id === only || testCase.id.startsWith(`${only}:`))
  : CASES.filter((testCase) => !testCase.optIn);
if (!cases.length) {
  console.error(`No case "${only}". Case ids: ${CASES.map((testCase) => testCase.id).join(", ")}`);
  process.exit(1);
}

const allModels = await listModels();
const nemotronModels = allModels.filter((id) => /nemotron/i.test(id));
console.log(`Nemotron models on this account: ${nemotronModels.join(", ") || "none"}`);

const unavailable = requestedModels.filter((id) => !allModels.includes(id));
if (unavailable.length) {
  console.error(`Not available on this account: ${unavailable.join(", ")}`);
  process.exit(1);
}
const defaultModel = NEMOTRON_CANDIDATES.find((id) => allModels.includes(id)) ?? nemotronModels[0];
const models = requestedModels.length ? requestedModels : [defaultModel].filter(Boolean);
if (!models.length) {
  console.error("No Nemotron model available on this Nebius account/region.");
  process.exit(1);
}

const allResults = [];
for (const model of models) {
  console.log(`\n=== ${model} ===`);
  const runs = [];
  let shownRaw = false;
  for (const testCase of cases) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const label = repeat > 1 ? `${testCase.id} #${attempt}` : testCase.id;
      console.log(`\n[${label}] ${testCase.title}`);
      const run = await runLoop(model, testCase);
      runs.push(run);
      printRun(run);

      // One raw tool-call message per model, to see the exact response shape.
      const toolRound = run.rounds.find((r) => r.raw && r.toolCalls.length);
      if (toolRound && !shownRaw) {
        printRawMessage(toolRound.raw);
        shownRaw = true;
      }

      const c = makeChecks();
      checkProtocol(run, c);
      if (!run.error) testCase.check(run, c);
      printChecks(c.results);
      allResults.push(...c.results.map((r) => ({ model, caseId: label, ...r })));
    }
  }
  printModelNotes(runs);
}

console.log("\n=== Summary ===");
for (const model of models) {
  const results = allResults.filter((r) => r.model === model);
  const count = (status) => results.filter((r) => r.status === status).length;
  console.log(`${model}: ${count("PASS")} pass, ${count("WARN")} warn, ${count("FAIL")} fail`);
  for (const r of results.filter((r) => r.status === "WARN" || r.status === "FAIL")) {
    console.log(`  ${r.status} [${r.caseId}] ${r.label}${r.detail ? `: ${r.detail}` : ""}`);
  }
}
process.exitCode = allResults.some((r) => r.status === "FAIL") ? 1 : 0;
