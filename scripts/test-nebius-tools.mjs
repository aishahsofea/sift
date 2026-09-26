// Spike: verify native tool calling on Nebius Token Factory + Nemotron before
// building Sift's agent loop, where the model decides on its own whether to
// call search_site / fetch_page, reads the results, maybe searches again, and
// only then answers. Checked live rather than assumed:
//   - tool calls come back parsed in message.tool_calls, not as raw text
//   - streamed tool-call arguments arrive in fragments that must be joined
//   - multi-round conversations with role: "tool" messages are accepted
//   - which way of forcing a final answer at the round cap actually works
//   - latency, prompt tokens and prefix caching at a realistic page size
// It also checks the third tool, cite_page (ADR 0005, #10), where the model
// quotes the page before answering from it and the handler verifies each quote:
//   - an array argument survives Nemotron's tool-call parser and streaming
//   - the model calls it before answering an on-page question, and not before searching
//   - its quotes are copied verbatim (the verification pass rate)
//   - a rejected quote comes back as a tool-role error the model recovers from
//   - what the extra round costs, against the same cases with --no-cite
// Both search tools are stubbed against a fictional site (loomkit.example), so
// every expected answer is only knowable from the page or a stubbed tool result,
// never from the model's own knowledge. No Tavily calls are made.
//
// Run with:
//   npm run test:tools                         # default Nemotron model
//   npm run test:tools -- <model-id> [...]     # compare specific models
//   npm run test:tools -- --only=<case-id>     # one case, or a group: --only=force compares force strategies (comma-separate several)
//   npm run test:tools -- --repeat=<n>         # run each case n times, for flaky behavior
//   npm run test:tools -- --no-cite            # the pre-#10 prompt and tools: the baseline cite_page's cost is measured against
//   npm run test:tools -- --show-reasoning     # print each round's chain of thought, to see why the model picked a tool
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

const SEARCH_TOOLS = [
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

// The page-side tool. Needs no network, so it is offered whether or not search
// is. The wording is verified prompt surface like the rest: change it here and in
// src/background/nebius/tools.ts together, then re-run this script.
const CITE_TOOL = {
  type: "function",
  function: {
    name: "cite_page",
    description:
      "Quote the passages of the page content that support your answer. Call it before you answer from the page content; search and fetch results can't be cited. Each quote is checked against the page content, so copy it word for word: a quote that isn't found is rejected.",
    parameters: {
      type: "object",
      properties: {
        quotes: {
          type: "array",
          items: { type: "string" },
          description:
            "Up to three short passages, each a sentence or less, copied exactly from the page content: no paraphrasing, no ellipses.",
        },
      },
      required: ["quotes"],
    },
  },
};

const ALL_TOOLS = [...SEARCH_TOOLS, CITE_TOOL];

// Which tools a case is offered: search unless the case turns it off (the
// no-Tavily-key path), and cite_page unless the run is the --no-cite baseline.
function toolsFor(testCase) {
  return [...(testCase.noSearch ? [] : SEARCH_TOOLS), ...(citeEnabled ? [CITE_TOOL] : [])];
}

// Required arguments per tool, and whether each is a string or a list of strings.
const REQUIRED_ARGS = Object.fromEntries(
  ALL_TOOLS.map((t) => [
    t.function.name,
    Object.fromEntries(
      t.function.parameters.required.map((key) => [
        key,
        t.function.parameters.properties[key].type === "array" ? "string[]" : "string",
      ]),
    ),
  ]),
);

// Ways to force the final answer once the round cap is hit. Verified on
// Nemotron 3 Nano (2026-09-23, 5 runs each): with tool_choice "none", or with
// tools omitted, the model still writes a tool call, which comes back as raw
// <tool_call> markup in content every time. Only omitting tools plus a nudge
// message gave a clean answer (5/5). The nudge is a transient user message for
// that one call, never kept in history. The two rejected strategies only run
// with --only=force, to recheck them on another model.
const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it.";
// On a whole page the model has been told to quote before it answers, so with the tools
// off it reached for cite_page anyway, and the loop ended in an error. This one names
// cite_page and says no tool at all. FORCE_RETRY is added if the forced round still comes
// back as a tool call, once. Mirror FORCE_NUDGE_CITE / FORCE_RETRY in
// src/background/nebius/tools.ts.
const FORCE_NUDGE_CITE =
  "You've used all your tool calls, and cite_page is no longer available. Answer now, in plain text, from the page and the results above. If they don't cover the question, say you couldn't find it.";
const FORCE_RETRY = "Do not call any tool. Write your answer as plain text now.";
const FORCE_STRATEGIES = {
  "tool-choice-none": (messages, tools) => ({ messages, params: { tools, tool_choice: "none" } }),
  "omit-tools": (messages) => ({ messages, params: {} }),
  "omit-tools+nudge": (messages) => ({
    messages: [...messages, { role: "user", content: citeEnabled ? FORCE_NUDGE_CITE : FORCE_NUDGE }],
    params: {},
  }),
};
const DEFAULT_FORCE_STRATEGY = "omit-tools+nudge";

// Tool-call syntax that should have been parsed into message.tool_calls. In
// content it would render raw markup as the answer; in the reasoning of a
// round with no tool_calls it points at a missed server-side parse.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i;
const TOOL_JSON = /"name"\s*:\s*"(search_site|fetch_page|cite_page)"/;

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

// The same page with the typography real articles have: curly quotes and
// apostrophes, an em dash, an ellipsis character, a non-breaking hyphen. A quote is
// verified against the page text as written, so whether the model copies these
// faithfully decides how often a good answer would be labelled unverified.
const TYPO_PAGE = {
  ...PAGE,
  content: [
    PAGE.content,
    "",
    "The Loomkit team called 2.0 \u201cthe biggest update since launch\u201d \u2014 a rewrite of the board engine that\u2019s been two years in the making\u2026 Existing customers get it at no extra cost, and the new guest\u2011seat pricing is unchanged.",
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
// cite_page: the check the real handler runs (src/background/handlers/verifyQuotes.ts),
// reimplemented here like everything else in this standalone script.

// Below this a "quote" matches almost any page and proves nothing.
const MIN_QUOTE_CHARS = 10;
const collapse = (text) => text.replace(/\s+/g, " ").trim();

// The page as the model saw it: the title and content the system prompt shows.
const pageText = (page) => [page.title, page.content].join("\n");

const RECOVERY_HINT =
  "Copy each passage exactly as it appears in the page content. If the page doesn't say it, don't cite it. Search results can't be cited.";
// Once one quote has verified the label has what it needs, so the result says to stop
// (on real pages the model kept citing after every quote had verified). Mirrors
// CITE_DONE_NOTE / CITE_PARTIAL_NOTE / CITE_NUDGE in src/background/nebius/tools.ts.
const CITE_DONE_NOTE = "All of these are on the page. Answer now from them, in your own words. Don't call cite_page again.";
const CITE_PARTIAL_NOTE = "Only the verified passages are on the page. Answer now using only those, and don't call cite_page again.";
// Sent, for that one request, when the model answered a page question without calling
// cite_page: the answer is discarded and this asks again.
const CITE_NUDGE =
  "Before you answer, call cite_page with up to three short passages from the page content that support your answer, copied word for word. If the page content doesn't cover the question, say so instead.";

// Checks every quote against the page. `injectRejection` fails the whole call
// regardless, to see how the model reacts to an error it can't have caused.
function citePage(page, quotes, { injectRejection = false } = {}) {
  const haystack = collapse(pageText(page));
  const verified = [];
  const errors = [];
  for (const quote of quotes) {
    const text = collapse(quote);
    if (text.length < MIN_QUOTE_CHARS) {
      errors.push(`quote too short: ${JSON.stringify(clip(text, 80))}`);
    } else if (injectRejection || !haystack.includes(text)) {
      errors.push(`quote not found in page text: ${JSON.stringify(clip(text, 80))}`);
    } else if (!verified.includes(text)) {
      verified.push(text);
    }
  }
  return { verified, errors };
}

// The checks every case that offers cite_page shares. A no-op under --no-cite.
function checkCitation(run, c, { expectVerified = true } = {}) {
  if (!citeEnabled) return;
  const { citations } = run.state;
  const firstToolRound = run.rounds.find((r) => r.toolCalls.length);
  c.should(
    firstToolRound?.toolCalls.some((tc) => tc.name === "cite_page"),
    "called cite_page before answering",
    firstToolRound ? `first tool round was ${firstToolRound.toolCalls.map((tc) => tc.name).join(", ")}` : "answered with no tool call",
  );
  const verified = citations.flatMap((x) => x.verified);
  const rejected = citations.flatMap((x) => x.errors);
  if (expectVerified) {
    c.should(verified.length > 0, "at least one quote verified against the page", `${rejected.length} rejected: ${rejected.join(" | ")}`);
  }
  c.info("quotes", `${verified.length} verified, ${rejected.length} rejected${rejected.length ? `: ${rejected.join(" | ")}` : ""}`);
}

// ---------------------------------------------------------------------------
// Cases. `search(query, state)` stubs search_site; `check(run, c)` adds the
// case's own checks on top of the protocol checks every case gets.

// One on-page question per fact the fixture holds, so quote-verification pass
// rate and the cost of the cite_page round are measured over more than one phrasing.
const onPageCase = (id, title, question, expected) => ({
  id: `on-page:${id}`,
  title: `On-page question (${title}): cite_page, then answer without searching`,
  question,
  search: () => RESULTS.unrelated,
  check(run, c) {
    const used = run.state.queries.length + run.state.fetchedUrls.length;
    c.should(
      used === 0,
      "answered without searching",
      `over-searched: ${JSON.stringify(run.state.queries.map((q) => q.query))}`,
    );
    c.must(expected.test(run.answer), `answer comes from the page (${expected})`, preview(run.answer));
    checkCitation(run, c);
  },
});

const CASES = [
  {
    id: "loop",
    title: "Off-page question: search_site, then answer from the result",
    question: PRICE_QUESTION,
    search: () => RESULTS.pricing,
    check(run, c) {
      const searched = run.rounds.some((r) => r.toolCalls.some((tc) => tc.name === "search_site"));
      c.must(searched, "called search_site for an off-page question", `answered directly: ${preview(run.rounds[0].content)}`);
      // Citing the page first is a wasted round: the price was never on it.
      c.should(
        run.rounds[0].toolCalls.every((tc) => tc.name === "search_site"),
        "searched first instead of citing the page",
        `first round: ${run.rounds[0].toolCalls.map((tc) => tc.name).join(", ")}`,
      );
      c.must(PRICE.test(run.answer), "final answer uses the tool result ($17.50)", preview(run.answer));
    },
  },
  {
    id: "on-page",
    title: "On-page question (testers): cite_page, then answer without searching",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    check(run, c) {
      const used = run.state.queries.length + run.state.fetchedUrls.length;
      c.should(
        used === 0,
        "answered without searching",
        `over-searched: ${JSON.stringify(run.state.queries.map((q) => q.query))}`,
      );
      c.must(/1,?200/.test(run.answer), "answer comes from the page (1,200 testers)", preview(run.answer));
      checkCitation(run, c);
    },
  },
  onPageCase("author", "author", "Who wrote this post?", /dana\sreyes/i),
  onPageCase("features", "features", "What's new in Loomkit 2.0?", /timeline/i),
  // \s, not a space: Nemotron writes "March 3" and "Dana Reyes" with no-break spaces (U+202F, U+00A0).
  onPageCase("date", "date", "When was this published?", /march\s3/i),
  {
    id: "cite:typography",
    title: "On-page question whose answer has curly quotes, an em dash and an ellipsis: does the model copy them?",
    page: TYPO_PAGE,
    question: "What did the Loomkit team call the 2.0 release, and how long was the rewrite in the making?",
    search: () => RESULTS.unrelated,
    check(run, c) {
      c.must(/biggest\supdate/i.test(run.answer), "answer comes from the page (biggest update since launch)", preview(run.answer));
      checkCitation(run, c);
    },
  },
  {
    // The limit ADR 0005 states: one verified quote is a floor, not proof. The page
    // names guest seats and gives no price, so the honest answer is "not on the page";
    // a model that quotes the guest-seats line and then invents a price is the #5
    // failure in miniature, and it earns the page label.
    id: "cite:partial",
    title: "Page half-covers the question (guest seats exist, no price): quote the seats line, then invent the price?",
    question: "How much do guest seats cost?",
    noSearch: true,
    check(run, c) {
      c.should(!MADE_UP_PRICE.test(run.answer), "doesn't invent a guest-seat price", preview(run.answer));
      checkCitation(run, c, { expectVerified: false });
    },
  },
  {
    // The cap is hit right after cite_page. The model has been told to quote before it
    // answers and has just done so; with the tools off it must not reach for cite_page
    // again. On real pages, follow-up questions ended in an error this way.
    id: "force:cite",
    title: "Round cap hit right after cite_page: does the forced round answer instead of citing again?",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    citeOnly: true,
    maxToolRounds: 1,
    check(run, c) {
      const forced = run.rounds.find((r) => r.forced);
      c.should(Boolean(forced), "reached the forced final call", "answered before the cap");
      c.info("forced round needed the retry", String(run.state.forcedRetried));
      c.must(/1,?200/.test(run.answer ?? ""), "forced answer still has the page's fact (1,200 testers)", preview(run.answer ?? ""));
    },
  },
  {
    id: "cite:nudge",
    title: "Model answers an on-page question without citing: the answer is thrown away and it quotes first",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    citeOnly: true,
    skipFirstRound: true,
    check(run, c) {
      c.must(run.state.askedToQuote, "the uncited answer was thrown away and the model asked to quote", "nothing was thrown away");
      const afterNudge = run.rounds.slice(1);
      c.should(
        afterNudge.some((r) => r.toolCalls.some((tc) => tc.name === "cite_page")),
        "called cite_page when asked",
        `did: ${afterNudge.map((r) => (r.toolCalls.map((tc) => tc.name).join("+") || "answer")).join(", ")}`,
      );
      c.must(/1,?200/.test(run.answer), "final answer still comes from the page (1,200 testers)", preview(run.answer));
      checkCitation(run, c);
    },
  },
  {
    // The other side of the nudge: a page that doesn't cover the question gives the model
    // nothing honest to quote. It is told it may say so; check it takes that way out
    // instead of inventing a passage to satisfy the request.
    id: "cite:nudge-abstain",
    title: "Model answers without citing a question the page doesn't cover: does the nudge push it into inventing a quote?",
    question: PRICE_QUESTION,
    noSearch: true,
    citeOnly: true,
    skipFirstRound: true,
    check(run, c) {
      c.must(run.state.askedToQuote, "the uncited answer was thrown away and the model asked to quote", "nothing was thrown away");
      const verified = run.state.citations.flatMap((x) => x.verified);
      const rejected = run.state.citations.flatMap((x) => x.errors);
      c.must(verified.length === 0, "no quote about the price verifies (it isn't on the page)", `verified: ${JSON.stringify(verified)}`);
      c.should(!MADE_UP_PRICE.test(run.answer), "doesn't make up a price", preview(run.answer));
      c.info("after the nudge", `${run.state.citations.length} cite call(s), ${rejected.length} invented quote(s) rejected`);
    },
  },
  {
    // Adversarial: the first call is rejected even though its quote is on the page, so
    // the model is told it is wrong about something it is right about. It usually
    // re-cites; in about 1 run in 7 it thinks until the token limit and returns nothing
    // (finish_reason "length"), which shows as a FAIL here and would be an error in the
    // extension. A real rejection does not do this to it, since real ones are misquotes.
    id: "cite:recover",
    title: "cite_page rejects the first call: the model corrects itself instead of the loop failing",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    citeOnly: true,
    rejectFirstCite: true,
    check(run, c) {
      const { citations } = run.state;
      c.must(citations.length > 0 && citations[0].injected, "cite_page was called and the first call was rejected", `${citations.length} cite call(s)`);
      const retried = citations.slice(1).some((x) => x.verified.length);
      c.should(retried, "called cite_page again and got a quote through", `answered without a verified quote: ${preview(run.answer)}`);
      c.must(/1,?200/.test(run.answer), "final answer still comes from the page (1,200 testers)", preview(run.answer));
    },
  },
  {
    id: "cite:stream",
    title: "On-page question, streamed like the extension does: cite_page's array argument joined from deltas",
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    stream: true,
    check(run, c) {
      const fragments = run.rounds.flatMap((r) => r.streamInfo.argFragments);
      if (fragments.length) c.info("argument fragments per tool call", fragments.join(", "));
      c.must(/1,?200/.test(run.answer), "answer comes from the page (1,200 testers)", preview(run.answer));
      checkCitation(run, c);
    },
  },
  {
    id: "cite:no-search",
    title: "No search, off-page question: does the model invent quotes to justify an answer?",
    question: PRICE_QUESTION,
    noSearch: true,
    check(run, c) {
      c.should(!MADE_UP_PRICE.test(run.answer), "doesn't make up a price", preview(run.answer));
      const { citations } = run.state;
      const verified = citations.flatMap((x) => x.verified);
      c.must(verified.length === 0, "no quote about the price verifies (it isn't on the page)", `verified: ${JSON.stringify(verified)}`);
      const rejected = citations.flatMap((x) => x.errors);
      c.info("invented quotes", `${rejected.length} rejected${rejected.length ? `: ${rejected.join(" | ")}` : ""}`);
    },
  },
  {
    // ADR 0001's headline: page and web in one answer. With cite_page the model has
    // two paths to choose between, so check it still combines them.
    id: "mixed",
    title: "Question needing both the page and a search: does the two-path prompt still combine them?",
    question: "How many beta testers were in the preview, and how much does the Loomkit Pro plan cost?",
    search: () => RESULTS.pricing,
    check(run, c) {
      c.should(run.state.queries.length > 0, "searched for the part the page doesn't cover", `answered directly: ${preview(run.answer)}`);
      c.must(/1,?200/.test(run.answer), "answer has the page's part (1,200 testers)", preview(run.answer));
      c.must(PRICE.test(run.answer), "answer has the search's part ($17.50)", preview(run.answer));
      const verified = run.state.citations.flatMap((x) => x.verified);
      if (citeEnabled) c.info("label this would get", `${verified.length ? "page+web" : "web"} (${verified.length} quote(s) verified)`);
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
  {
    // The cost that matters for the on-page case: every round re-sends the page,
    // so the cite_page round should be a cache hit, not a second full prefill.
    id: "big-page-on-page",
    title: "Realistic page size (~100K chars), on-page question: what the cite_page round costs",
    page: padPage(PAGE, 100_000),
    question: "How many beta testers were in the preview?",
    search: () => RESULTS.unrelated,
    check(run, c) {
      c.must(/1,?200/.test(run.answer), "answer comes from the page (1,200 testers)", preview(run.answer));
      checkCitation(run, c);
    },
  },
];

// ---------------------------------------------------------------------------
// Agent loop

async function runLoop(model, testCase) {
  const messages = [
    { role: "system", content: systemPrompt(testCase.page ?? PAGE, { search: !testCase.noSearch, cite: citeEnabled }) },
    ...(testCase.history ?? []),
    { role: "user", content: testCase.question },
  ];
  const state = {
    searchRounds: 0,
    queries: [],
    allowedUrls: new Set(),
    fetchedUrls: [],
    inventedUrls: [],
    citations: [],
    askedToQuote: false,
    discardedAnswer: null,
    forcedRetried: false,
  };
  const rounds = [];
  const maxToolRounds = testCase.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const send = testCase.stream ? chatStream : chat;
  const forceStrategy = testCase.forceStrategy ?? DEFAULT_FORCE_STRATEGY;
  const tools = toolsFor(testCase);
  const done = (fields) => ({ rounds, state, answer: null, error: null, ...fields });

  // Mirrors runAgentLoop: an answer to a page question with no tool called is thrown
  // away, once, and the model asked to quote first. Not counted as a tool round.
  let toolRounds = 0;
  let quoteNudge = null;
  let forcedRetried = false;

  for (let round = 1; ; round++) {
    const forced = toolRounds >= maxToolRounds;
    let call;
    if (forced) {
      call = FORCE_STRATEGIES[forceStrategy](messages, tools);
      if (forcedRetried) call = { ...call, messages: [...call.messages, { role: "user", content: FORCE_RETRY }] };
    }
    // skipFirstRound: round 1 gets the pre-cite_page prompt and tools, so the model
    // answers straight away. That is what a skipped cite_page looks like, on demand, to
    // test what the nudge does about it. (Dropping the tools instead would make it write
    // the cite_page call out as raw markup, which is a different failure.)
    else if (testCase.skipFirstRound && round === 1) {
      const baseline = [{ role: "system", content: systemPrompt(testCase.page ?? PAGE, { search: !testCase.noSearch, cite: false }) }, ...messages.slice(1)];
      call = { messages: baseline, params: testCase.noSearch ? {} : { tools: SEARCH_TOOLS } };
    }
    else call = { messages: quoteNudge ? [...messages, quoteNudge] : messages, params: tools.length ? { tools } : {} };
    quoteNudge = null;
    let result;
    try {
      result = await send(model, call.messages, call.params);
    } catch (error) {
      return done({ error: `round ${round}${forced ? ` (forced via ${forceStrategy})` : ""}: ${error.message}` });
    }
    rounds.push({ round, forced, forceMode: forced ? forceStrategy : null, ...result });

    if (!result.toolCalls.length) {
      // `rounds` already holds this one, and it has no tool calls, so it can't be the reason to stop.
      if (citeEnabled && !state.askedToQuote && rounds.every((r) => !r.toolCalls.length)) {
        state.askedToQuote = true;
        state.discardedAnswer = result.content;
        quoteNudge = { role: "user", content: CITE_NUDGE };
        continue;
      }
      return done({ answer: result.content });
    }
    if (forced) {
      // Mirrors runAgentLoop: once more, then it is an error.
      if (!forcedRetried) {
        forcedRetried = true;
        state.forcedRetried = true;
        continue;
      }
      return done({ error: `round ${round}: model still called tools on the forced final call` });
    }
    toolRounds++;

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
  if (tc.name === "cite_page") {
    const injectRejection = Boolean(testCase.rejectFirstCite) && state.citations.length === 0;
    const { verified, errors } = citePage(testCase.page ?? PAGE, tc.args.quotes, { injectRejection });
    state.citations.push({ round, quotes: tc.args.quotes, verified, errors, injected: injectRejection });
    const verifiedSoFar = state.citations.flatMap((x) => x.verified).length > 0;
    if (!verifiedSoFar) return { verified, error: `${errors.join("; ")}. ${RECOVERY_HINT}` };
    return errors.length
      ? { verified, error: errors.join("; "), note: CITE_PARTIAL_NOTE }
      : { verified, note: CITE_DONE_NOTE };
  }
  if (tc.name === "search_site") {
    state.queries.push({ round, query: tc.args.query });
    const results = testCase.search(tc.args.query, state);
    for (const r of results) state.allowedUrls.add(r.url);
    return withWebNote({ results }, "search");
  }
  // fetch_page: the allowlist rule the real handler will enforce. Only URLs a
  // search_site call returned, never one the model (or injected page text) made up.
  state.fetchedUrls.push(tc.args.url);
  if (!state.allowedUrls.has(tc.args.url)) {
    state.inventedUrls.push(tc.args.url);
    return { error: "fetch_page only accepts URLs returned by search_site." };
  }
  return withWebNote({ url: tc.args.url, content: FULL_PAGES[tc.args.url] ?? "" }, "fetch");
}

// Mirrors src/background/nebius/promptAssembly.ts for a whole (untruncated)
// page: `search` is whether Tavily is configured, `cite` whether cite_page is offered.
// With both, the answer instructions are two explicit paths: cite_page only on the
// page path. A single "cite before you answer from the page" line was read as a
// step in every answer, so the model cited search snippets.
// Search and fetch results say they aren't the page, in the message the model
// reads last. The system prompt said the same and was ignored: after a search the
// model cited the snippet ("it matches the page"), which is rejected, and the wasted
// rounds ran into the round cap. Mirrors SEARCH_NOTE / FETCH_NOTE in
// src/background/nebius/tools.ts.
function withWebNote(output, kind) {
  if (!citeEnabled) return output;
  const note =
    kind === "fetch"
      ? "This is the full text of a fetched page, not the page content the user is viewing, so cite_page can't check it. Answer from it now."
      : "These are search results, not the page content, so cite_page can't check them. Answer from them now, or search again.";
  return { ...output, note };
}

function systemPrompt(page, { search, cite }) {
  const site = new URL(page.url).hostname;
  const toolInstructions = search
    ? [
        `If it doesn't (or only covers part of it), call search_site to search ${site}. If the results don't help, search again with a better query.`,
        "If a result's snippet isn't enough, call fetch_page with that result's URL to read the page in full.",
      ]
    : ["You have no search available, so if the page doesn't cover the question, say so."];
  if (cite && search) {
    return [
      `You answer questions about the web page the user is viewing on ${site}. There are two ways to answer.`,
      "1. From the page content below, when it covers the question: first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them.",
      `2. From the site, when the page content doesn't cover the question (or only part of it): call search_site to search ${site}, and search again with a better query if the results don't help. If a result's snippet isn't enough, call fetch_page with that result's URL. Then answer from the results. Don't call cite_page on this path: it only checks the page content below, never search or fetch results.`,
      "Never answer from outside knowledge. If neither the page nor the search results cover the question, say so.",
      "",
      `Page title: ${page.title}`,
      `Page URL: ${page.url}`,
      "Page content:",
      page.content,
    ].join("\n");
  }
  return [
    `You answer questions about the web page the user is viewing on ${site}.`,
    cite
      ? "If the page content below covers the question, first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them."
      : "Answer from the page content below whenever it covers the question.",
    ...toolInstructions,
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
    for (const [key, kind] of Object.entries(REQUIRED_ARGS[name] ?? {})) {
      const value = args[key];
      const isText = (v) => typeof v === "string" && v.trim();
      const ok = kind === "string[]" ? Array.isArray(value) && value.length > 0 && value.every(isText) : isText(value);
      if (!ok) problems.push(kind === "string[]" ? `"${key}" isn't a non-empty list of strings (${clip(JSON.stringify(value) ?? "missing", 80)})` : `missing "${key}" argument`);
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
    if (showReasoning && r.reasoning) console.log(`      reasoning: ${JSON.stringify(clip(r.reasoning, 900))}`);
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

// What each case cost, averaged over its runs: the number that prices cite_page's
// extra round. Compare a normal run with a --no-cite one on the same cases.
function printCostSummary(runs) {
  // Grouped by hand: Map.groupBy needs Node 21, and the repo supports Node ^20.19.
  const byCase = new Map();
  for (const run of runs.filter((r) => !r.error)) byCase.set(run.caseId, [...(byCase.get(run.caseId) ?? []), run]);
  if (!byCase.size) return;
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const sum = (run, pick) => run.rounds.reduce((total, r) => total + (pick(r) ?? 0), 0);
  console.log(`\n  cost per case, mean over completed runs${citeEnabled ? "" : " (--no-cite baseline)"}`);
  for (const [caseId, group] of byCase) {
    const parts = [
      `n=${group.length}`,
      `rounds ${mean(group.map((run) => run.rounds.length)).toFixed(1)}`,
      `${(mean(group.map((run) => sum(run, (r) => r.ms))) / 1000).toFixed(1)}s`,
      `prompt ${Math.round(mean(group.map((run) => sum(run, (r) => r.usage?.prompt_tokens)))).toLocaleString("en-US")}`,
      `cached ${Math.round(mean(group.map((run) => sum(run, (r) => r.usage?.prompt_tokens_details?.cached_tokens)))).toLocaleString("en-US")}`,
      `completion ${Math.round(mean(group.map((run) => sum(run, (r) => r.usage?.completion_tokens)))).toLocaleString("en-US")}`,
    ];
    if (citeEnabled) {
      const cited = group.filter((run) => run.state.citations.length).length;
      const verified = group.filter((run) => run.state.citations.some((x) => x.verified.length)).length;
      parts.push(`cite_page called ${cited}/${group.length}`, `quote verified ${verified}/${group.length}`);
    }
    console.log(`    ${caseId.padEnd(18)} ${parts.join("  ")}`);
  }
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
// --no-cite runs the pre-#10 prompt and tools, the baseline for cite_page's cost.
const citeEnabled = !cliArgs.includes("--no-cite");
// --show-reasoning prints each round's chain of thought, to see why the model picked a tool.
const showReasoning = cliArgs.includes("--show-reasoning");

if (!Number.isInteger(repeat) || repeat < 1) {
  console.error("--repeat must be a positive integer.");
  process.exit(1);
}
// --only takes case ids or group prefixes, comma-separated: --only=loop,cite
const wanted = only?.split(",") ?? [];
const cases = (
  only
    ? CASES.filter((testCase) => wanted.some((id) => testCase.id === id || testCase.id.startsWith(`${id}:`)))
    : CASES.filter((testCase) => !testCase.optIn)
).filter((testCase) => citeEnabled || !testCase.citeOnly);
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
  console.log(`\n=== ${model}${citeEnabled ? "" : " (--no-cite baseline)"} ===`);
  const runs = [];
  let shownRaw = false;
  for (const testCase of cases) {
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const label = repeat > 1 ? `${testCase.id} #${attempt}` : testCase.id;
      console.log(`\n[${label}] ${testCase.title}`);
      const run = await runLoop(model, testCase);
      run.caseId = testCase.id;
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
  printCostSummary(runs);
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
