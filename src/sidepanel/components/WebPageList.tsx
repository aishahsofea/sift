import type { WebPage, WebPages } from '../../shared/types'

const FOUND_SHOWN = 3

function pathOf(url: string): string {
  const { pathname, search } = new URL(url)
  return `${pathname}${search}`
}

function PageItem({ page }: { page: WebPage }) {
  return (
    <li>
      <a href={page.url} target="_blank" rel="noopener noreferrer">
        {page.title}
      </a>
      <span className="message-web-path">{pathOf(page.url)}</span>
      {page.partial && (
        <span className="message-web-partial" data-tooltip="Only the start of this page was read">
          partly read
        </span>
      )}
    </li>
  )
}

export function WebPageList({ pages }: { pages: WebPages }) {
  const total = pages.read.length + pages.found.length
  const shown = pages.found.slice(0, FOUND_SHOWN)
  const hidden = pages.found.slice(FOUND_SHOWN)
  return (
    <details className="message-web">
      <summary>{total === 1 ? '1 web page' : `${total} web pages`}</summary>
      {pages.read.length > 0 && (
        <>
          <h4>Read</h4>
          <ul>
            {pages.read.map((page) => (
              <PageItem key={page.url} page={page} />
            ))}
          </ul>
        </>
      )}
      {pages.found.length > 0 && (
        <>
          <h4 data-tooltip="Search results the answer may have used from their snippets; not opened in full">Also found</h4>
          <ul>
            {shown.map((page) => (
              <PageItem key={page.url} page={page} />
            ))}
          </ul>
          {hidden.length > 0 && (
            <details className="message-web-more">
              <summary>{`${hidden.length} more`}</summary>
              <ul>
                {hidden.map((page) => (
                  <PageItem key={page.url} page={page} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </details>
  )
}
