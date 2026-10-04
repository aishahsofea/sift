// Live spike of native tool calling on Nebius + Nemotron (ADR 0001, 0005, 0006, #7) against a fictional site (loomkit.example) with stubbed tools, so answers can't come from model knowledge. No Tavily calls.
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
// Once the model has used this many tool rounds, the next call is forced to answer.
const MAX_TOOL_ROUNDS = 3;
// Mirrors FETCHED_PAGE_CHAR_LIMIT in src/shared/constants.ts (#7).
const FETCH_PAGE_CHAR_LIMIT = 20_000;

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

// Offered whether or not search is; change the wording here and in src/background/nebius/tools.ts together.
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

// Mirrors SEARCH_PAGE_TOOL in src/background/nebius/tools.ts.
const SEARCH_PAGE_TOOL = {
  type: "function",
  function: {
    name: "search_page",
    description:
      "Search the whole page, including the part that is cut off from the page content, or the text of a page you fetched with fetch_page if that came back cut off too. Returns the passages that best match your words, each with the character offset it starts at. Use it when the question is about a part that isn't in what you were given.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The words to look for, as they'd be written on the page: names and key terms, not a whole question.",
        },
      },
      required: ["query"],
    },
  },
};

// Mirrors CITE_TOOL_CUT.
const CITE_TOOL_CUT = {
  ...CITE_TOOL,
  function: {
    ...CITE_TOOL.function,
    description:
      "Quote the passages of the page that support your answer. Call it before you answer from the page, whether the passages are in the page content or came from search_page; search_site and fetch_page results can't be cited. Each quote is checked against the whole page, so copy it word for word: a quote that isn't found is rejected.",
    parameters: {
      ...CITE_TOOL.function.parameters,
      properties: {
        quotes: {
          ...CITE_TOOL.function.parameters.properties.quotes,
          description: "Up to three short passages, each a sentence or less, copied exactly from the page: no paraphrasing, no ellipses.",
        },
      },
    },
  },
};

const ALL_TOOLS = [...SEARCH_TOOLS, SEARCH_PAGE_TOOL, CITE_TOOL];

// A case whose page reaches the model cut short, with the rest kept (ADR 0006).
const isCut = (testCase) => Boolean(testCase.page?.truncated);

// Search unless the case turns it off, search_page on a cut page, cite_page unless --no-cite.
function toolsFor(testCase) {
  return [
    ...(testCase.noSearch ? [] : SEARCH_TOOLS),
    ...(isCut(testCase) ? [SEARCH_PAGE_TOOL] : []),
    ...(citeEnabled ? [isCut(testCase) ? CITE_TOOL_CUT : CITE_TOOL] : []),
  ];
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

// Verified on Nemotron 3 Nano (2026-09-23, 5 runs each): tool_choice "none" or omitted tools still yields raw <tool_call> markup; only omitting tools plus a nudge gave a clean answer (5/5). The rejected strategies run only with --only=force.
const FORCE_NUDGE =
  "You've used all your searches. Answer now from the page and the results above. If they don't cover the question, say you couldn't find it.";
// Names cite_page, since with tools off the model reached for it anyway. Mirrors FORCE_NUDGE_CITE / FORCE_RETRY in tools.ts.
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

// Tool-call syntax that should have been parsed into message.tool_calls; in the reasoning of a no-tool-call round it means a missed server-side parse.
const TOOL_MARKUP = /<\/?tool_?call>|<TOOLCALL>|<function[=\s>]/i;
const TOOL_JSON = /"name"\s*:\s*"(search_site|fetch_page|cite_page|search_page)"/;

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

// Real typography (curly quotes, em dash, ellipsis, non-breaking hyphen): quotes verify against the page as written, so faithful copying decides how often good answers read as unverified.
const TYPO_PAGE = {
  ...PAGE,
  content: [
    PAGE.content,
    "",
    "The Loomkit team called 2.0 \u201cthe biggest update since launch\u201d \u2014 a rewrite of the board engine that\u2019s been two years in the making\u2026 Existing customers get it at no extra cost, and the new guest\u2011seat pricing is unchanged.",
  ].join("\n"),
};

// Page longer than the prompt (ADR 0006): `content` is the head, `full` the page as kept; the head names and summarizes section 5, whose body is past the cut (the #5 state).
const CUT_HEAD = [
  "The Loomkit Sync Incident: a postmortem",
  "By Dana Reyes, co-founder. Published April 9, 2026.",
  "",
  "Contents",
  "1. Summary",
  "2. Timeline",
  "3. Impact",
  "4. Detection",
  "5. Anatomy of the Sync Incident",
  "6. What we changed",
  "",
  "1. Summary",
  "On March 18 two clients could write to the same Loomkit board at once, and edits from one of them were lost. Section 5 traces how a stale lock let that happen, and section 6 lists what we changed.",
  "",
  "2. Timeline",
  "The first lost edit was reported at 09:14 UTC. We paused board writes at 09:52 UTC and resumed at 11:30 UTC.",
  "",
  "3. Impact",
  "Eleven boards had lost edits. No board was deleted.",
  "",
  "4. Detection",
  "A customer reported the first lost edit. Our own alerts did not fire.",
  "",
].join("\n");

const CUT_TAIL = [
  "5. Anatomy of the Sync Incident",
  "Every board write takes a lock that lasts 45 seconds. The clock on our eu-west-3 region had drifted 52 seconds behind the others, so a lock granted there had already expired by the time the other regions read it. A second client was granted the same lock while the first was still writing.",
  "",
  "Both clients then wrote to the board, and the later write replaced the earlier one without merging. The database accepted both writes because nothing compared the lock's age with the write.",
  "",
  "6. What we changed",
  "We replaced the time-based lock with fencing tokens: every lock grant now carries a number that rises with each grant, and the database rejects any write carrying a lower number than one it has already seen. We also added an alert for clock drift over 5 seconds.",
  "",
  "Thanks to everyone who reported lost edits.",
].join("\n");

const CUT_PAGE = {
  title: "The Loomkit Sync Incident: a postmortem",
  url: "https://loomkit.example/blog/sync-incident-postmortem",
  content: CUT_HEAD,
  full: CUT_HEAD + CUT_TAIL,
  truncated: true,
  charsOmitted: CUT_TAIL.length,
};
// What only section 5 says: the drift, and the lock that had already expired.
const CUT_CAUSE = /52|drift|expired|eu-west-3/i;

const PRICING_URL = "https://loomkit.example/pricing";
const PRICING_TEXT =
  "Loomkit pricing. Free: up to 3 boards and 2 members. Pro: $17.50 per user per month billed annually, or $21 billed monthly. Business: custom pricing with SSO and audit logs.";
const PRICE = /17\.50/;
const MADE_UP_PRICE = /\$\s?\d/;
const PRICE_QUESTION = "How much does the Loomkit Pro plan cost?";

// Reached only via fetch_page, padded past FETCH_PAGE_CHAR_LIMIT so the number is past fetch_page's own cut (#7).
const PRUNING_URL = "https://loomkit.example/help/board-pruning";
const PRUNING_HEAD = "How Loomkit prunes inactive boards\n\nBoards that stop getting used are archived automatically.\n";
const PRUNING_TAIL = "\nA board is pruned once its inactivity score passes a threshold of 0.87.";
const BIG_PRUNING_PAGE = padCut({ content: PRUNING_HEAD, full: PRUNING_HEAD + PRUNING_TAIL }, FETCH_PAGE_CHAR_LIMIT + 4_000);
const PRUNING_SNIPPET = "An overview of how Loomkit decides a board has gone stale and archives it.";
const PRUNING_SCORE = /0\.87/;

// #7's shape: the snippet names the mechanism, not the score. Measured 2026-09-28, 12 runs each: page read 5 times, snippet answered 7, on old and reworded SEARCH_NOTE alike (ADR 0009).
const PARTIAL_URL = "https://loomkit.example/help/board-archiving";
const PARTIAL_SNIPPET = "Loomkit automatically archives boards that have gone inactive. Archiving is based on how recently a board was edited.";
const PARTIAL_PAGE = [
  "How Loomkit archives inactive boards",
  "",
  "Every night Loomkit scores each board from 0 to 1 using its edits, comments and views from the last 30 days. Boards that score below 0.87 are archived, and members are notified 3 days before.",
].join("\n");

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

// fetch_page contents: each result's snippet, except the full pricing page and the pruning help page.
const FULL_PAGES = {
  ...Object.fromEntries(Object.values(RESULTS).flat().map((r) => [r.url, r.content])),
  [PRICING_URL]: PRICING_TEXT,
  [PRUNING_URL]: BIG_PRUNING_PAGE.full,
  [PARTIAL_URL]: PARTIAL_PAGE,
};

// ---------------------------------------------------------------------------
// cite_page: reimplements the check in src/background/handlers/verifyQuotes.ts.

// Below this a "quote" matches almost any page and proves nothing.
const MIN_QUOTE_CHARS = 10;
const collapse = (text) => text.replace(/\s+/g, " ").trim();

// The title and content the prompt shows; on a cut page all of it, since a quote can come from search_page (ADR 0006).
const pageText = (page) => [page.title, page.full ?? page.content].join("\n");

const RECOVERY_HINT =
  "Copy each passage exactly as it appears in the page content. If the page doesn't say it, don't cite it. Search results can't be cited.";
// Once one quote verifies the result says to stop. Mirrors CITE_DONE_NOTE / CITE_PARTIAL_NOTE / CITE_NUDGE in tools.ts.
const CITE_DONE_NOTE = "All of these are on the page. Answer now from them, in your own words. Don't call cite_page again.";
const CITE_PARTIAL_NOTE = "Only the verified passages are on the page. Answer now using only those, and don't call cite_page again.";
// Sent for one request when a page question was answered without cite_page.
const CITE_NUDGE =
  "Before you answer, call cite_page with up to three short passages from the page content that support your answer, copied word for word. If the page content doesn't cover the question, say so instead.";
// Same ask on a cut page, plus search_page's result notes. Mirror CITE_NUDGE_CUT / PAGE_SEARCH_NOTE / PAGE_SEARCH_EMPTY_NOTE.
const CITE_NUDGE_CUT =
  "Before you answer, call cite_page with up to three short passages from the page that support your answer, copied word for word. If the passages are in the part that is cut off, call search_page for them first. If the page doesn't cover the question, say so instead.";
const PAGE_SEARCH_NOTE =
  "These passages are from the page, so cite_page can check them. Call cite_page with up to three short passages from them that support your answer, copied word for word, then answer. If none of them covers the question, search again with different words.";
const PAGE_SEARCH_EMPTY_NOTE =
  "Nothing on the page matches those words. Search again with different words, or answer from what you have.";
// search_page notes for a fetched page: not citable, so SEARCH_NOTE's shape. Mirror PAGE_SEARCH_NOTE_FETCHED / PAGE_SEARCH_EMPTY_NOTE_FETCHED.
const PAGE_SEARCH_NOTE_FETCHED =
  "These passages are from the fetched page, not the page you're viewing, so cite_page can't check them. Answer from them now, or search again with different words.";
const PAGE_SEARCH_EMPTY_NOTE_FETCHED =
  "Nothing past the start of the fetched page matches those words. Search again with different words, or answer from what you have.";
// Mirrors FETCH_NOTE_CUT in tools.ts, shown whether or not cite_page is offered.
function FETCH_NOTE_CUT(charsOmitted) {
  const omitted = charsOmitted.toLocaleString("en-US");
  return `This is the fetched page, not the page content the user is viewing, so cite_page can't check it either way. It is cut off too: its last ${omitted} characters are not included. If it doesn't have the answer, call search_page with words from the missing part to reach it.`;
}

// `injectRejection` fails the whole call, to see how the model handles an error it didn't cause.
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

// Crude stand-in for searchPage.ts (BM25): paragraphs sharing words with the query, best first, with two slots held for the cut-off part. Measures what the model does with a result, not ranking.
function searchPageStub(page, query) {
  const stem = (word) => word.toLowerCase().replace(/s$/, "");
  const words = (text) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
  const terms = new Set(words(query).filter((word) => word.length >= 3));
  const scored = [];
  // The head and the cut-off part are split apart, so a paragraph never runs across the cut.
  for (const [chunk, base, cut] of [
    [page.content, 0, false],
    [page.full.slice(page.content.length), page.content.length, true],
  ]) {
    let offset = base;
    for (const text of chunk.split("\n\n")) {
      const score = words(text).filter((word) => terms.has(word)).length;
      if (score > 0 && text.trim()) scored.push({ offset, text: text.trim(), score, cut });
      offset += text.length + 2;
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const chosen = scored.filter((p) => p.cut).slice(0, 2);
  for (const p of scored) if (chosen.length < 4 && !chosen.includes(p)) chosen.push(p);
  return chosen.sort((a, b) => b.score - a.score).map(({ offset, text }) => ({ offset, text }));
}

// Shared cut-page checks (ADR 0006): searched the unseen part, quoted, and quoted from it; `expectSearch: false` is where the head answers.
function checkCutPage(run, c, page, { expectSearch = true } = {}) {
  const { citations, pageSearches, pagePassages, pageQueries } = run.state;
  const verified = citations.flatMap((x) => x.verified);
  const rejected = citations.flatMap((x) => x.errors);
  if (expectSearch) {
    c.should(pageSearches > 0, "called search_page for the part that is cut off", "never searched it: answered from the head, or searched the site");
    c.should(pagePassages > 0, "search_page found the section", `queries ${JSON.stringify(pageQueries)} found nothing`);
  } else {
    c.should(pageSearches === 0, "did not search the cut-off part, since the head answers", `searched ${JSON.stringify(pageQueries)}`);
  }
  c.should(verified.length > 0, "at least one quote verified against the whole page", `${rejected.length} rejected: ${rejected.join(" | ")}`);
  if (expectSearch) {
    const head = collapse(page.content);
    c.should(
      verified.some((quote) => !head.includes(quote)),
      "a verified quote comes from the part the prompt did not hold",
      `verified: ${JSON.stringify(verified)}`,
    );
  }
  // Mirrors deriveSource: on a cut page a quote counts only if it is inside a passage search_page returned.
  const fromSearch = verified.filter((quote) => run.state.passageTexts.some((text) => text.includes(quote)));
  if (expectSearch) c.should(fromSearch.length > 0, "a verified quote is one taken from a passage search_page returned", `verified: ${JSON.stringify(verified)}`);
  const label = fromSearch.length ? "page" : "unverified";
  c.info(
    "label this would get",
    `${label} (${verified.length} quote(s) verified, ${pagePassages} passage(s) found, searches ${JSON.stringify(pageQueries)}${rejected.length ? `, rejected ${rejected.join(" | ")}` : ""})`,
  );
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

// Cases. `search(query, state)` stubs search_site; `check(run, c)` adds the case's own checks.

// One question per fixture fact, so quote pass rate and cite_page's cost are measured over several phrasings.
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

// The cut page at the size Sift sends, built once: padding 120K characters is not free.
const BIG_CUT_PAGE = padCut(CUT_PAGE, 120_000);

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
    // ADR 0005's limit: one verified quote is a floor. The page gives no price, so a model that quotes guest seats then invents one is the #5 failure in miniature.
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
    // Cap hit right after cite_page: with tools off the model must not reach for it again (follow-ups ended in an error this way).
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
    // A page that doesn't cover the question: check the model takes the offered way out instead of inventing a passage.
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
    // Adversarial: a correct quote is rejected. The model usually re-cites; about 1 run in 7 it thinks to the token limit (finish_reason "length"), a FAIL here. Real rejections are misquotes, so this doesn't happen.
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
  // Page longer than the prompt (ADR 0006, #11): the head names the section and only search_page reaches the body (#5 in miniature).
  {
    id: "cut:section",
    title: "Cut page, question about the section the head only names and summarizes: search_page, quote it, answer from it",
    page: CUT_PAGE,
    citeOnly: true,
    question: "How did the sync incident happen? I want the details.",
    search: () => RESULTS.unrelated,
    check(run, c) {
      c.must(CUT_CAUSE.test(run.answer), "answer has what only the cut-off section says (the drifted clock, the expired lock)", preview(run.answer));
      const used = run.state.queries.length + run.state.fetchedUrls.length;
      c.should(used === 0, "answered without searching the site", `searched the site: ${JSON.stringify(run.state.queries.map((q) => q.query))}`);
      checkCutPage(run, c, CUT_PAGE);
    },
  },
  {
    id: "cut:no-search",
    title: "Same question with no Tavily key: search_page and cite_page are all it has",
    page: CUT_PAGE,
    noSearch: true,
    citeOnly: true,
    question: "How did the sync incident happen? I want the details.",
    check(run, c) {
      c.must(CUT_CAUSE.test(run.answer), "answer has what only the cut-off section says (the drifted clock, the expired lock)", preview(run.answer));
      checkCutPage(run, c, CUT_PAGE);
    },
  },
  {
    id: "cut:head",
    title: "Cut page, question the head answers: no reason to search the part that was cut off",
    page: CUT_PAGE,
    citeOnly: true,
    question: "Who wrote this postmortem?",
    search: () => RESULTS.unrelated,
    check(run, c) {
      c.must(/dana\sreyes/i.test(run.answer), "answer comes from the head (Dana Reyes)", preview(run.answer));
      checkCutPage(run, c, CUT_PAGE, { expectSearch: false });
    },
  },
  {
    id: "cut:absent",
    title: "Cut page, question neither part covers, no site search: does it invent a figure?",
    page: CUT_PAGE,
    noSearch: true,
    citeOnly: true,
    question: "How much did the incident cost in refunds?",
    check(run, c) {
      c.should(!MADE_UP_PRICE.test(run.answer), "doesn't make up a refund figure", preview(run.answer));
      const { pageSearches, pagePassages, pageQueries } = run.state;
      c.info("page searches", `${pageSearches} call(s), ${pagePassages} passage(s), ${JSON.stringify(pageQueries)}`);
    },
  },
  {
    id: "cut:mixed",
    title: "Cut page, question needing the cut-off part and a search of the site: do the paths still combine?",
    page: CUT_PAGE,
    citeOnly: true,
    question: "What caused the sync incident, and how much does the Loomkit Pro plan cost?",
    search: () => RESULTS.pricing,
    check(run, c) {
      c.should(run.state.queries.length > 0, "searched the site for the price", `answered directly: ${preview(run.answer)}`);
      c.must(CUT_CAUSE.test(run.answer), "answer has the cut-off section's part (the drifted clock)", preview(run.answer));
      c.must(PRICE.test(run.answer), "answer has the site's part ($17.50)", preview(run.answer));
      checkCutPage(run, c, CUT_PAGE);
    },
  },
  {
    // The first answer skips every tool (about 1 run in 10 on a whole page) and is discarded; checks the model then searches the rest. Round 1 has no page tools.
    id: "cut:nudge",
    title: "Cut page, model answers without looking: the answer is thrown away and it searches and quotes first",
    page: CUT_PAGE,
    noSearch: true,
    citeOnly: true,
    skipFirstRound: true,
    question: "How did the sync incident happen? I want the details.",
    check(run, c) {
      c.must(run.state.askedToQuote, "the uncited answer was thrown away and the model asked to quote", "nothing was thrown away");
      c.must(CUT_CAUSE.test(run.answer), "final answer has what only the cut-off section says", preview(run.answer));
      checkCutPage(run, c, CUT_PAGE);
    },
  },
  {
    // ADR 0001 measured 21,120 of 23,454 prompt tokens cached on a ~100K-char page; re-measure on a cut page.
    id: "cut:big-page",
    title: "Cut page at a realistic size (~120K-char head): latency, tokens, and whether the prefix is still cached across rounds",
    page: BIG_CUT_PAGE,
    citeOnly: true,
    question: "How did the sync incident happen? I want the details.",
    search: () => RESULTS.unrelated,
    check(run, c) {
      c.must(CUT_CAUSE.test(run.answer), "answer has what only the cut-off section says (the drifted clock, the expired lock)", preview(run.answer));
      checkCutPage(run, c, BIG_CUT_PAGE);
      c.info("cached / prompt tokens per round", run.rounds.map((r) => `${r.usage?.prompt_tokens_details?.cached_tokens ?? "n/a"}/${r.usage?.prompt_tokens ?? "n/a"}`).join(", "));
      const later = run.rounds.slice(1).filter((r) => r.usage?.prompt_tokens);
      if (later.length) {
        const share = later.reduce((sum, r) => sum + (r.usage.prompt_tokens_details?.cached_tokens ?? 0) / r.usage.prompt_tokens, 0) / later.length;
        c.should(share > 0.5, "later rounds are served mostly from the prompt cache", `${(share * 100).toFixed(0)}% cached`);
      }
    },
  },
  {
    // ADR 0001's headline: page and web in one answer; check it still combines the two paths.
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
    // #7: fetch_page's own result comes back cut; only search_page on it reaches the number.
    id: "fetch:cut",
    title: "fetch_page result itself comes back cut: search_page reaches past its own cut",
    question: "How does Loomkit decide when to prune an inactive board?",
    search: () => [{ title: "Board pruning", url: PRUNING_URL, content: PRUNING_SNIPPET }],
    check(run, c) {
      const { fetchedUrls, allowedUrls, fetchedFullContent } = run.state;
      const fetched = fetchedUrls.some((url) => allowedUrls.has(url));
      c.must(fetched, "called fetch_page for the help page", `answer: ${preview(run.answer)}`);
      c.must(
        fetchedFullContent !== undefined,
        "the fetch came back cut, so the rest was kept for search_page",
        "fetch_page result was not cut: make BIG_PRUNING_PAGE longer than FETCH_PAGE_CHAR_LIMIT",
      );
      const searchedFetch = run.rounds.some((r) => r.toolCalls.some((tc) => tc.name === "search_page"));
      c.should(
        searchedFetch,
        "called search_page to reach past the fetch's own cut",
        `tools called: ${run.rounds.flatMap((r) => r.toolCalls.map((tc) => tc.name)).join(", ")}`,
      );
      c.must(PRUNING_SCORE.test(run.answer), "final answer has the number only reachable past the fetch's own cut (0.87)", preview(run.answer));
    },
  },
  {
    // A measurement, not a gate: the model answers from a half-answering snippet about half the time (#7). Opt-in via --only=snippet:partial.
    id: "snippet:partial",
    title: "Snippet half-answers the question: does the model read the page, or answer from the summary?",
    question: "How does Loomkit decide which inactive boards to archive?",
    optIn: true,
    search: () => [{ title: "Board archiving | Loomkit", url: PARTIAL_URL, content: PARTIAL_SNIPPET }],
    check(run, c) {
      const { fetchedUrls, allowedUrls } = run.state;
      const fetched = fetchedUrls.some((url) => allowedUrls.has(url));
      c.should(fetched, "read the page instead of answering from the snippet", `answered from the snippet: ${preview(run.answer)}`);
      // Only the page says these: an answer that has them without reading it made them up.
      const pageOnly = /comment|views?\b|30 days|0\.87|3 days/i.test(run.answer);
      c.should(fetched || !pageOnly, "without reading, asserts nothing only the page states", preview(run.answer));
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
    // Every round re-sends the page, so the cite_page round should be a cache hit.
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
    { role: "system", content: systemPrompt(testCase.page ?? PAGE, { search: !testCase.noSearch, cite: citeEnabled, pageSearch: isCut(testCase) && citeEnabled }) },
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
    pageSearches: 0,
    pagePassages: 0,
    passageTexts: [],
    pageQueries: [],
    askedToQuote: false,
    discardedAnswer: null,
    forcedRetried: false,
    fetchedFullContent: undefined,
  };
  const rounds = [];
  const maxToolRounds = testCase.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const send = testCase.stream ? chatStream : chat;
  const forceStrategy = testCase.forceStrategy ?? DEFAULT_FORCE_STRATEGY;
  const tools = toolsFor(testCase);
  const done = (fields) => ({ rounds, state, answer: null, error: null, ...fields });

  // Mirrors runAgentLoop: a tool-less page answer is discarded once and the model asked to quote; not a tool round.
  let toolRounds = 0;
  let quoteNudge = null;
  let forcedRetried = false;

  for (let round = 1; ; round++) {
    const forced = toolRounds >= maxToolRounds;
    // Mirrors agentLoop.ts's roundTools: a cut fetch adds search_page for the rest of the turn (#7).
    const roundTools = isCut(testCase) || state.fetchedFullContent === undefined ? tools : [...tools, SEARCH_PAGE_TOOL];
    let call;
    if (forced) {
      call = FORCE_STRATEGIES[forceStrategy](messages, roundTools);
      if (forcedRetried) call = { ...call, messages: [...call.messages, { role: "user", content: FORCE_RETRY }] };
    }
    // skipFirstRound: round 1 gets the pre-cite_page prompt and tools, so the model answers straight away; dropping tools would make it write raw markup instead.
    else if (testCase.skipFirstRound && round === 1) {
      const baseline = [{ role: "system", content: systemPrompt(testCase.page ?? PAGE, { search: !testCase.noSearch, cite: false, pageSearch: false }) }, ...messages.slice(1)];
      call = { messages: baseline, params: testCase.noSearch ? {} : { tools: SEARCH_TOOLS } };
    }
    else call = { messages: quoteNudge ? [...messages, quoteNudge] : messages, params: roundTools.length ? { tools: roundTools } : {} };
    quoteNudge = null;
    let result;
    try {
      result = await send(model, call.messages, call.params);
    } catch (error) {
      return done({ error: `round ${round}${forced ? ` (forced via ${forceStrategy})` : ""}: ${error.message}` });
    }
    rounds.push({ round, forced, forceMode: forced ? forceStrategy : null, ...result });

    if (!result.toolCalls.length) {
      // Mirrors mustQuoteFirst: not after only page searches, nor after a page search that found nothing.
      const searchedPageOnly = rounds.every((r) => r.toolCalls.every((tc) => tc.name === "search_page"));
      const foundNothing = state.pageSearches > 0 && state.pagePassages === 0;
      if (citeEnabled && !state.askedToQuote && searchedPageOnly && !foundNothing) {
        state.askedToQuote = true;
        state.discardedAnswer = result.content;
        quoteNudge = { role: "user", content: isCut(testCase) ? CITE_NUDGE_CUT : CITE_NUDGE };
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

    // Echo the assistant turn without its reasoning, as the real handler keeps it.
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
  if (tc.name === "search_page") {
    // Mirrors searchWholePage: a cut fetch takes priority over the tab page (#7).
    if (state.fetchedFullContent !== undefined) {
      const passages = searchPageStub({ content: state.fetchedFullContent.slice(0, FETCH_PAGE_CHAR_LIMIT), full: state.fetchedFullContent }, tc.args.query);
      state.pageSearches++;
      state.pagePassages += passages.length;
      state.pageQueries.push(tc.args.query);
      return { passages, note: passages.length ? PAGE_SEARCH_NOTE_FETCHED : PAGE_SEARCH_EMPTY_NOTE_FETCHED };
    }
    if (!isCut(testCase)) return { error: "search_page is not available." };
    const passages = searchPageStub(testCase.page, tc.args.query);
    state.pageSearches++;
    state.pagePassages += passages.length;
    state.passageTexts.push(...passages.map((p) => collapse(p.text)));
    state.pageQueries.push(tc.args.query);
    return { passages, note: passages.length ? PAGE_SEARCH_NOTE : PAGE_SEARCH_EMPTY_NOTE };
  }
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
  // Allowlist: only URLs a search_site call returned, never model- or page-supplied ones.
  state.fetchedUrls.push(tc.args.url);
  if (!state.allowedUrls.has(tc.args.url)) {
    state.inventedUrls.push(tc.args.url);
    return { error: "fetch_page only accepts URLs returned by search_site." };
  }
  // Mirrors runTool's fetch_page branch: cut at the same limit, rest kept for search_page (#7).
  const full = FULL_PAGES[tc.args.url] ?? "";
  const cut = full.length > FETCH_PAGE_CHAR_LIMIT;
  if (cut) state.fetchedFullContent = full;
  const content = cut ? full.slice(0, FETCH_PAGE_CHAR_LIMIT) : full;
  return withWebNote({ url: tc.args.url, content }, "fetch", cut ? full.length - FETCH_PAGE_CHAR_LIMIT : 0);
}

// Mirrors promptAssembly.ts and SEARCH_NOTE / FETCH_NOTE in tools.ts. With search and cite there are two explicit paths, cite_page only on the page path; notes in tool results say they aren't the page. `charsOmitted` is set only on a cut fetch (#7), whose note shows regardless of citeEnabled.
function withWebNote(output, kind, charsOmitted = 0) {
  if (kind === "fetch" && charsOmitted) return { ...output, note: FETCH_NOTE_CUT(charsOmitted) };
  if (!citeEnabled) return output;
  const note =
    kind === "fetch"
      ? "This is the full text of a fetched page, not the page content the user is viewing, so cite_page can't check it. Answer from it now."
      : "These are search results, not the page content, so cite_page can't check them. If a snippet has the answer, use it now. If none does, call fetch_page with that result's URL to read it in full, or search again with a better query.";
  return { ...output, note };
}

function systemPrompt(page, { search, cite, pageSearch = false }) {
  const site = new URL(page.url).hostname;
  const intro = `You answer questions about the web page the user is viewing on ${site}.`;
  const quoteThenAnswer =
    "first call cite_page with up to three short passages (a sentence or less each) that support your answer, copied word for word, then answer from them.";
  const searchTheSite = `call search_site to search ${site}, and search again with a better query if the results don't help. If a result's snippet isn't enough, call fetch_page with that result's URL. If that page comes back cut off too, call search_page to reach the rest of it. Then answer from the results.`;
  let instructions;
  if (pageSearch) {
    // A page cut short in the prompt whose rest search_page can reach (ADR 0006).
    const findFirst = "If the passages you need are in the part that is cut off, call search_page to find them first.";
    instructions = search
      ? [
          `${intro} There are two ways to answer.`,
          `1. From the page, when it covers the question: ${quoteThenAnswer} ${findFirst}`,
          `2. From the site, when the page doesn't cover the question (or only part of it): ${searchTheSite} Don't call cite_page on this path: it only checks the page, never search_site or fetch_page results.`,
        ]
      : [
          intro,
          `If the page covers the question, ${quoteThenAnswer} ${findFirst}`,
          "You can't search the rest of the site, so if the page doesn't cover the question, say so.",
        ];
  } else if (cite && search) {
    instructions = [
      `${intro} There are two ways to answer.`,
      `1. From the page content below, when it covers the question: ${quoteThenAnswer}`,
      `2. From the site, when the page content doesn't cover the question (or only part of it): ${searchTheSite} Don't call cite_page on this path: it only checks the page content below, never search or fetch results.`,
    ];
  } else {
    instructions = [
      intro,
      cite
        ? `If the page content below covers the question, ${quoteThenAnswer}`
        : "Answer from the page content below whenever it covers the question.",
      ...(search
        ? [
            `If it doesn't (or only covers part of it), call search_site to search ${site}. If the results don't help, search again with a better query.`,
            "If a result's snippet isn't enough, call fetch_page with that result's URL to read the page in full. If that page comes back cut off too, call search_page to reach the rest of it.",
          ]
        : ["You have no search available, so if the page doesn't cover the question, say so."]),
    ];
  }
  // Only for a page the prompt holds the start of: search_page is the way out if offered, else search_site.
  const cutNotice = () => {
    const omitted = page.charsOmitted.toLocaleString("en-US");
    const cut = `The page content below is cut off: its last ${omitted} characters are not included, so every section after the cut is missing. A section the content only names or summarizes is one of them, and a summary is not the section.`;
    return pageSearch
      ? `${cut} To answer a question about a missing section, call search_page with words from it: it searches the whole page, including the part that is cut off. Do not answer from the summary.`
      : `${cut} Do not answer a question about a missing section from the page: ${search ? "call search_site for it" : "say the page was cut off"}.`;
  };
  return [
    ...instructions,
    "Never answer from outside knowledge. If neither the page nor the search results cover the question, say so.",
    ...(page.truncated ? [cutNotice()] : []),
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
    // Tool calls stream as fragments keyed by index; the args JSON parses only once joined.
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

  // A data: payload can split across reads, so carry the trailing partial line over.
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

// Nemotron returns `reasoning`, other wrappers `reasoning_content`; works on a message or a stream delta.
function reasoningOf(source) {
  if (source.reasoning) return { reasoning: source.reasoning, reasoningField: "reasoning" };
  if (source.reasoning_content) return { reasoning: source.reasoning_content, reasoningField: "reasoning_content" };
  return { reasoning: "", reasoningField: null };
}

// Normalizes one tool call and lists what the agent handler must defend against.
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

// Per-case cost averaged over runs, which prices cite_page's extra round; compare with a --no-cite run.
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

// Pads the fixture to realistic size (Sift caps extraction at 120K chars) with irrelevant release notes.
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

// A cut page at Sift's size: head padded with irrelevant log lines; the section past the cut is unchanged.
function padCut(page, targetChars) {
  const lines = [page.content, "Appendix: write log excerpt"];
  let length = lines.join("\n").length;
  for (let n = 1; length < targetChars; n++) {
    const line = `12:${String(n % 60).padStart(2, "0")}:${String((n * 7) % 60).padStart(2, "0")} UTC region ${n % 12} board ${n} write accepted, no conflicts recorded.`;
    lines.push(line);
    length += line.length + 1;
  }
  const content = `${lines.join("\n")}\n`;
  return { ...page, content, full: content + page.full.slice(page.content.length) };
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
