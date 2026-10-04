import { describe, expect, it } from 'vitest'
import { FETCHED_PAGE_CHAR_LIMIT, PAGE_SEARCH_FETCH_PASSAGES } from '../../shared/constants'
import {
  EDGE_THRESHOLD_RE,
  LOGIT_THRESHOLD_RE,
  METHODS_FULL_TEXT,
  NODE_THRESHOLD_RE,
} from '../../eval/fixtures/transformerCircuitsMethods'
import { searchPage } from './searchPage'

// Hand-written queries a model might write for #27's question over the real methods paper (thresholds in Appendix F past the cut); the issue's own 16 weren't recorded, so the baseline is measured here.
const QUERIES = [
  'pruning threshold',
  'pruning thresholds',
  'node pruning threshold',
  'threshold',
  'graph pruning',
  'prune',
  'pruning',
  'graph pruning method',
  'attribution graph pruning threshold values',
  'how nodes are pruned',
  'edge threshold pruning',
  'logit threshold',
  'node threshold 0.8',
  'pruning attribution graphs',
  'prune nodes attribution graph',
  'Appendix F thresholds',
]

function reachingAllThree(options?: Parameters<typeof searchPage>[3]): string[] {
  return QUERIES.filter((query) => {
    const found = searchPage(METHODS_FULL_TEXT, query, FETCHED_PAGE_CHAR_LIMIT, options)
      .map((passage) => passage.text)
      .join('\n')
    return [NODE_THRESHOLD_RE, EDGE_THRESHOLD_RE, LOGIT_THRESHOLD_RE].every((re) => re.test(found))
  })
}

describe('searchPage on the methods paper (#27)', () => {
  it('reaches all three thresholds for the baseline queries as shipped', () => {
    expect(reachingAllThree()).toHaveLength(10)
  })

  it.each([
    ['past the cut only', { pastCutOnly: true }, 12],
    ['six passages', { maxPassages: PAGE_SEARCH_FETCH_PASSAGES }, 15],
    ['past the cut, six passages', { pastCutOnly: true, maxPassages: PAGE_SEARCH_FETCH_PASSAGES }, 15],
  ])('%s', (_name, options, expected) => {
    expect(reachingAllThree(options)).toHaveLength(expected)
  })
})
