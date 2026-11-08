// Loading code on demand (e.g. the PDF generator). If the page is older than
// the server's files (a new version was deployed, or the local dev server
// restarted), the browser can't fetch the module; say so plainly.

export class StalePageError extends Error {
  constructor() {
    super('This page is out of date: the app was updated or its server restarted. Reload the page and try again.')
    this.name = 'StalePageError'
  }
}

const isLoadFailure = (e: unknown) =>
  e instanceof TypeError && /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(e.message)

export async function loadOnDemand<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (e) {
    throw isLoadFailure(e) ? new StalePageError() : e
  }
}
