import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { db } from '../../db/client.js';
import { transactionAttachments, transactions } from '../../db/schema.js';
import { detectAttachmentMime } from '../../domain/attachments/mime.js';
import {
  absPathFor,
  unlinkAttachment,
  writeAttachmentBytes,
} from '../../domain/attachments/storage.js';
import { userId } from '../plugins/auth.js';

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

// Escape a filename for the Content-Disposition header. Non-ASCII / control
// chars are stripped from the `filename=` fallback and the full name is
// re-emitted UTF-8-encoded in `filename*=UTF-8''…` per RFC 5987.
function contentDispositionValue(filename: string): string {
  const asciiSafe = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '\\"');
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8}`;
}

export async function attachmentsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.requireAuth);

  // POST /api/transactions/:id/attachments — multipart upload, 10 MB cap,
  // MIME sniffed from magic bytes (client Content-Type is ignored).
  app.post('/api/transactions/:id/attachments', async (req, reply) => {
    const uid = userId(req);
    const txId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(txId) || txId <= 0) {
      return reply.code(400).send({ error: 'invalid transaction id' });
    }

    // Ownership: 404 (not 403) when the transaction belongs to someone else,
    // matching the non-enumeration convention used across the codebase.
    const [tx] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, txId), eq(transactions.userId, uid)));
    if (!tx) return reply.code(404).send({ error: 'transaction not found' });

    if (!req.isMultipart()) return reply.code(400).send({ error: 'no file uploaded' });
    // fastify-multipart enforces the byte cap and throws once exceeded; we
    // catch that to return a proper 413 with our canonical error shape
    // instead of the default 500.
    let data;
    try {
      data = await req.file({ limits: { fileSize: ATTACHMENT_MAX_BYTES } });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'attachment exceeds 10 MB limit' });
      }
      throw err;
    }
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });

    const filename = data.filename;
    if (!filename || filename.length > 255) {
      return reply.code(400).send({ error: 'invalid filename' });
    }

    const buffer = await data.toBuffer();
    // fastify-multipart sets `truncated` when the cap was hit mid-stream.
    if (data.file.truncated) {
      return reply.code(413).send({ error: 'attachment exceeds 10 MB limit' });
    }
    if (buffer.length === 0) return reply.code(400).send({ error: 'empty file' });

    const mime = detectAttachmentMime(buffer);
    if (!mime) {
      return reply.code(400).send({
        error: 'unsupported file type (allowed: JPEG, PNG, WebP, HEIC, PDF)',
      });
    }

    // Insert the row first to reserve the id — the on-disk filename derives
    // from that id, so we cannot write the file before it exists.
    const [row] = await db
      .insert(transactionAttachments)
      .values({
        userId: uid,
        transactionId: txId,
        filename,
        mime,
        sizeBytes: buffer.length,
        storedPath: '', // patched below
      })
      .returning();
    if (!row) throw new Error('attachment insert failed');

    try {
      const rel = await writeAttachmentBytes(uid, row.id, buffer);
      await db
        .update(transactionAttachments)
        .set({ storedPath: rel })
        .where(eq(transactionAttachments.id, row.id));
      return reply.code(201).send({
        attachment: {
          id: row.id,
          transactionId: txId,
          filename,
          mime,
          sizeBytes: buffer.length,
          createdAt: row.createdAt.toISOString(),
        },
      });
    } catch (err) {
      // Best-effort rollback of the reservation row so a failed disk write
      // doesn't leave a phantom entry pointing at a missing file.
      await db
        .delete(transactionAttachments)
        .where(eq(transactionAttachments.id, row.id));
      throw err;
    }
  });

  // GET /api/transactions/:id/attachments — list for a given transaction
  app.get('/api/transactions/:id/attachments', async (req, reply) => {
    const uid = userId(req);
    const txId = Number((req.params as { id: string }).id);
    if (!Number.isInteger(txId) || txId <= 0) {
      return reply.code(400).send({ error: 'invalid transaction id' });
    }
    const [tx] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, txId), eq(transactions.userId, uid)));
    if (!tx) return reply.code(404).send({ error: 'transaction not found' });

    const rows = await db
      .select({
        id: transactionAttachments.id,
        transactionId: transactionAttachments.transactionId,
        filename: transactionAttachments.filename,
        mime: transactionAttachments.mime,
        sizeBytes: transactionAttachments.sizeBytes,
        createdAt: transactionAttachments.createdAt,
      })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, txId))
      .orderBy(asc(transactionAttachments.id));

    return {
      attachments: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });

  // GET /api/attachments/:id/download — stream the file with the original
  // filename in Content-Disposition.
  app.get('/api/attachments/:id/download', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid attachment id' });
    }
    const [row] = await db
      .select()
      .from(transactionAttachments)
      .where(and(eq(transactionAttachments.id, id), eq(transactionAttachments.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'attachment not found' });

    reply
      .header('Content-Type', row.mime)
      .header('Content-Disposition', contentDispositionValue(row.filename))
      .header('Content-Length', String(row.sizeBytes));
    return reply.send(createReadStream(absPathFor(row.storedPath)));
  });

  // DELETE /api/attachments/:id — removes DB row + disk file.
  app.delete('/api/attachments/:id', async (req, reply) => {
    const uid = userId(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid attachment id' });
    }
    const [row] = await db
      .select()
      .from(transactionAttachments)
      .where(and(eq(transactionAttachments.id, id), eq(transactionAttachments.userId, uid)));
    if (!row) return reply.code(404).send({ error: 'attachment not found' });

    await db
      .delete(transactionAttachments)
      .where(eq(transactionAttachments.id, row.id));
    await unlinkAttachment(row.storedPath);
    return reply.code(204).send();
  });
}
