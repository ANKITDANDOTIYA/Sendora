/**
 * Minimal stub for `next/server` so Jest can run route handler tests
 * without loading the full Next.js runtime.
 */

export class NextResponse {
  constructor(body, init = {}) {
    this._body = body;
    this.status = init.status ?? 200;
    this.headers = new Map(Object.entries(init.headers ?? {}));
  }

  async json() {
    return this._body;
  }

  static json(data, init = {}) {
    return new NextResponse(data, init);
  }
}
