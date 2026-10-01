# Devpost submission draft

Not part of the product. Edit before pasting into Devpost.

## Track

Best Apps & Agents (also eligible for Best Use of Tavily).

## Description

Sift is a Chrome extension that answers questions about the page you're reading
and shows its work. The model (NVIDIA Nemotron on Nebius Token Factory) decides
for itself whether the page covers your question. If it doesn't, it searches the
rest of the site through Tavily and says so.

What makes it different from "chat with a page":

- **Verified quotes.** To answer from the page, the model must quote it. Sift
  checks each quote against the page text in code, then labels the answer
  *from the page*, *from the web*, *from both*, or a grey *not checked*.
- **Long pages.** Past what fits in the prompt, the full text stays in the
  browser and the model searches it locally with a `search_page` tool.
- **Regression-tested grounding.** A live eval set runs the real agent loop
  against fixture and real pages (ADR 0007).

## Testing instructions (private field)

1. Download `sift-extension.zip` from the latest GitHub release, unzip, and
   Load unpacked at `chrome://extensions` (Developer mode on).
2. Extension options: paste the Nebius key and Tavily key below, Save.
3. Open any article, click the Sift icon, ask a question the page answers, then
   one it doesn't.

Nebius key: <PASTE AT SUBMIT TIME, NEVER COMMIT>
Tavily key: <PASTE AT SUBMIT TIME, NEVER COMMIT>

## Feedback on Nebius Token Factory and NVIDIA (required)

Check each point is still true and add your own before submitting.

- A 4xx from Nebius when several eval processes share one key surfaces as a key
  error, which hides that the real cause is rate limiting. A distinct
  rate-limit status or message would help.
- Reasoning text comes back under `message.reasoning` on some models/wrappers and
  `message.reasoning_content` on others. One documented field would simplify
  clients.
- Model IDs are best discovered from `GET /v1/models`; a stable alias for the
  current Nemotron model would avoid hardcoding.
- (Add: Nemotron tool-calling behavior you saw in `npm run test:tools`, latency,
  cost.)

## Video checklist (under 3 minutes, public on YouTube)

- Show it running in Chrome on a real page, not a mockup.
- Show a from-the-page answer with verified quotes, then a from-the-web answer.
- Show the grey "not checked" label once, to explain it.
- No copyrighted music or third-party logos.
