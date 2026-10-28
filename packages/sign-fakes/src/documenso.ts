import { randomUUID } from 'node:crypto';
import { isPdf, multipart, serve, type Reply, type Server } from './server.ts';

/**
 * A stand-in for the Documenso v2 API (envelopes), enforcing what the real one does that the plugin
 * relies on: the API key, a PDF upload, a signer with a signature field, distributing before signing,
 * and the signed PDF only once completed. Webhooks are sent by the test with `webhookBody`.
 */
export interface DocumensoEnvelope {
  id: string;
  title: string;
  status: 'DRAFT' | 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  itemId: string;
  pdf: Buffer;
  recipients: { name: string; email: string; role: string; fields: any[] }[];
  meta: Record<string, unknown>;
}

export interface DocumensoFake extends Server {
  envelopes: Map<string, DocumensoEnvelope>;
  /** The signer signs. */
  complete(id: string): void;
  reject(id: string): void;
  /** What Documenso posts to a webhook for this envelope. */
  webhookBody(id: string, event: 'DOCUMENT_COMPLETED' | 'DOCUMENT_REJECTED' | 'DOCUMENT_OPENED'): string;
}

const err = (status: number, message: string): Reply => ({ status, body: { message, code: status === 401 ? 'UNAUTHORIZED' : 'INVALID_BODY' } });

export async function startDocumensoFake(opts: { apiKey: string }): Promise<DocumensoFake> {
  const envelopes = new Map<string, DocumensoEnvelope>();
  const server = await serve((req) => {
    if (!req.path.startsWith('/api/v2/')) return err(404, 'not found');
    if (req.headers.authorization !== opts.apiKey) return err(401, 'Unauthorized');
    const path = req.path.slice('/api/v2'.length);
    if (req.method === 'POST' && path === '/envelope/create') {
      const parts = multipart(req);
      const payload = parts.find((p) => p.name === 'payload');
      const files = parts.filter((p) => p.name === 'files');
      if (!payload) return err(400, 'payload is required');
      const p = JSON.parse(payload.data.toString('utf8'));
      if (!p.title || p.type !== 'DOCUMENT') return err(400, 'title and type DOCUMENT are required');
      if (files.length !== 1 || !isPdf(files[0]!.data)) return err(400, 'one PDF file is required');
      const signers = (p.recipients ?? []).filter((r: any) => r.role === 'SIGNER');
      if (!signers.length || signers.some((r: any) => !r.email || !r.name)) return err(400, 'a signer with name and email is required');
      for (const r of signers) {
        const sig = (r.fields ?? []).filter((f: any) => f.type === 'SIGNATURE');
        if (!sig.length) return err(400, 'each signer needs a SIGNATURE field');
        for (const f of sig) if (!(f.page >= 1) || [f.positionX, f.positionY, f.width, f.height].some((v) => !(v >= 0 && v <= 100))) return err(400, 'field position out of range');
      }
      const id = `envelope_${randomUUID().slice(0, 8)}`;
      envelopes.set(id, { id, title: p.title, status: 'DRAFT', itemId: `item_${randomUUID().slice(0, 8)}`, pdf: files[0]!.data, recipients: p.recipients, meta: p.meta ?? {} });
      return { status: 200, body: { id } };
    }
    if (req.method === 'POST' && path === '/envelope/distribute') {
      const e = envelopes.get(req.body?.envelopeId);
      if (!e) return err(404, 'envelope not found');
      if (e.status !== 'DRAFT') return err(400, 'envelope already sent');
      e.status = 'PENDING';
      return { status: 200, body: { success: true, id: e.id, recipients: e.recipients.map((r, i) => ({ id: i + 1, name: r.name, email: r.email, token: `tok${i}`, role: r.role, signingOrder: 1, signingUrl: `https://documenso.test/sign/tok${i}` })) } };
    }
    const one = /^\/envelope\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && one) {
      const e = envelopes.get(one[1]!);
      if (!e) return err(404, 'envelope not found');
      return { status: 200, body: { id: e.id, title: e.title, status: e.status, envelopeItems: [{ id: e.itemId, envelopeId: e.id, documentDataId: 'dd', title: e.title, order: 1 }], recipients: e.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role })) } };
    }
    const dl = /^\/envelope\/item\/([^/]+)\/download$/.exec(path);
    if (req.method === 'GET' && dl) {
      const e = [...envelopes.values()].find((x) => x.itemId === dl[1]);
      if (!e) return err(404, 'item not found');
      const version = req.query.get('version') ?? 'signed';
      if (version === 'signed' && e.status !== 'COMPLETED') return err(400, 'the document is not completed');
      return { status: 200, raw: { type: 'application/pdf', data: version === 'signed' ? Buffer.concat([e.pdf, Buffer.from('\n%signed by documenso fake\n')]) : e.pdf } };
    }
    return err(404, 'not found');
  });
  const set = (id: string, status: DocumensoEnvelope['status']) => {
    const e = envelopes.get(id);
    if (!e || e.status !== 'PENDING') throw new Error(`envelope ${id} is not pending`);
    e.status = status;
  };
  return {
    ...server,
    envelopes,
    complete: (id) => set(id, 'COMPLETED'),
    reject: (id) => set(id, 'REJECTED'),
    webhookBody: (id, event) => {
      const e = envelopes.get(id)!;
      return JSON.stringify({ event, createdAt: new Date().toISOString(), webhookEndpoint: 'https://shop.test/webhooks', payload: { id: 1, envelopeId: e.id, title: e.title, status: e.status, recipients: e.recipients.map((r) => ({ email: r.email, envelopeId: e.id, signingStatus: e.status === 'COMPLETED' ? 'SIGNED' : 'NOT_SIGNED' })) } });
    },
  };
}
