// Day 1 sanity check: confirm the Nebius Token Factory + NVIDIA Nemotron
// round trip works before building anything else. Run with:
//   npm run test:nebius
// Requires NEBIUS_API_KEY in .env (see .env.example).

const BASE_URL = "https://api.tokenfactory.nebius.com/v1";

const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error("Missing NEBIUS_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
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

// Preferred Nemotron models in order, each checked against a live GET /v1/models; same list as src/background/nebius/modelDiscovery.ts.
const NEMOTRON_CANDIDATES = [
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  "nvidia/nemotron-3-super-120b-a12b",
];

async function chatCompletion(model) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a concise assistant." },
        { role: "user", content: "Say hello in exactly five words." },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /chat/completions failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

const allModels = await listModels();
const nemotronModels = allModels.filter((id) => /nemotron/i.test(id));
console.log(`Found ${nemotronModels.length} Nemotron model(s) on this account:`);
for (const id of nemotronModels) console.log(`  - ${id}`);

const target = NEMOTRON_CANDIDATES.find((id) => allModels.includes(id)) ?? nemotronModels[0];
if (!target) {
  console.error("No Nemotron model available on this Nebius account/region.");
  process.exit(1);
}
console.log(`\nTesting chat completion with: ${target}\n`);

const result = await chatCompletion(target);
const choice = result.choices[0];
console.log("--- raw message object ---");
console.log(JSON.stringify(choice.message, null, 2));

// Nemotron Nano returns `reasoning`, not `reasoning_content`.
const reasoning = choice.message.reasoning_content ?? choice.message.reasoning;
if (reasoning) {
  console.log("\n(!) This model splits output into a separate reasoning field.");
  console.log("reasoning:", reasoning);
}
console.log("\ncontent:", choice.message.content);
