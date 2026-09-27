import type { TavilySearchResult } from '../../background/tavily/client'
import type { ChatTurn, ExtractedPage } from '../../shared/types'

// A fictional product, deliberately different branding from loomkit.example
// (scripts/test-nebius-tools.mjs, agentLoop.test.ts) just so the two fixtures
// never look alike side by side.

// The on-page fact: findable with no tool at all.
export const BETA_TESTER_QUOTE =
  'Thanks to the 2,400 beta testers who reported over 5,000 false alerts during the preview'

// Deliberately absent from the page, for the off-page and partial cases.
const TEAM_PLAN_PRICE = '$22 per seat per month, billed annually'

export const page: ExtractedPage = {
  url: 'https://pulsegate.example/blog/introducing-pulsegate-3',
  title: 'Introducing Pulsegate 3.0',
  content: [
    'By Priya Chandran, founder.',
    '',
    `Pulsegate 3.0 changes how a check decides a service is actually down. ${BETA_TESTER_QUOTE}, Pulsegate now waits for two consecutive failed regions before it pages anyone, instead of one.`,
    '',
    'Pulsegate Team adds shared incident channels, a 90-day history, and a status page on your own domain.',
  ].join('\n'),
  extractionMethod: 'readability',
  truncated: false,
  charsOmitted: 0,
}

export const onPageQuestion = 'How many beta testers were there?'
export const offPageQuestion = 'How much does the Pulsegate Team plan cost per seat?'
export const partialQuestion = 'How many beta testers were there, and how much does the Team plan cost per seat?'
export const followUpQuestion = 'What else has she written?'

export const pricingResults: TavilySearchResult[] = [
  { title: 'Pulsegate pricing', url: 'https://pulsegate.example/pricing', content: `Team: ${TEAM_PLAN_PRICE}.` },
]

export const authorPostsResults: TavilySearchResult[] = [
  {
    title: 'Why false alerts cost more than outages',
    url: 'https://pulsegate.example/blog/false-alerts-cost-more',
    content: 'Priya Chandran on why teams under-invest in alert quality.',
  },
  {
    title: 'Priya Chandran — all posts',
    url: 'https://pulsegate.example/authors/priya-chandran',
    content: 'Posts by Priya Chandran, founder of Pulsegate.',
  },
]

// Prior context the follow-up's pronoun ("she") resolves against (ADR 0001 problem 1):
// a model writing "she" as its search_site query would search nothing useful.
export const authorEstablishedHistory: ChatTurn[] = [
  { role: 'user', content: 'Who wrote this post?' },
  { role: 'assistant', content: 'Priya Chandran, the founder, wrote it.', source: 'page', quotes: ['By Priya Chandran, founder.'] },
]
