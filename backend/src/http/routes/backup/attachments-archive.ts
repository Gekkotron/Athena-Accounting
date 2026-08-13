import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { userId } from '../../plugins/auth.js';
import {
  buildAttachmentsArchive,
  archiveToGzippedJson,
  parseGzippedJsonToArchive,
  restoreAttachmentsArchive,
} from '../../../domain/backup/attachments-archive.js';
import { BackupDecryptError, decryptBytes, encryptBytes } from './crypto.js';

const ARCHIVE_MAX_BYTES = 500 * 1024 * 1024;

// Cap kept high — a heavy user's attachment library is exactly the case the
// separate archive channel exists to handle. If we ever want a lower cap
// per deployment, wire it through env.

function archiveFilename(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `athena-attachments-${stamp}.bin`;
}

// Whitelist of characters the retention pruner can trust. Same shape as the
// JSON dump's isBackupFilename (dump.ts) so a foreign file dropped into the
// destination can never match.
export function isAttachmentArchiveFilename(name: string): boolean {
  return /^athena-attachments-\d{4}-\d{2}-\d{2}-\d{6}\.bin$/.test(name);
}

const ExportBody = z.object({ passphrase: z.string().min(8).max(1024) });

export function registerAttachmentsArchiveRoutes(app: FastifyInstance): void {
  // POST /api/backup/export-attachments — build the archive, gzip, encrypt,
  // stream the raw binary back. Same passphrase floor as the JSON export.
  app.post('/api/backup/export-attachments', async (req, reply) => {
    const parsed = ExportBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid input', issues: parsed.error.issues });
    }
    const archive = await buildAttachmentsArchive(userId(req));
    const gzipped = archiveToGzippedJson(archive);
    const envelope = encryptBytes(gzipped, parsed.data.passphrase);

    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${archiveFilename(new Date())}"`)
      .header('Content-Length', String(envelope.length));
    return reply.send(envelope);
  });

  // POST /api/backup/import-attachments — accepts multipart { passphrase, file }.
  // Decrypt-parse happens BEFORE any DB mutation so a wrong passphrase can
  // never destroy the current attachments.
  app.post('/api/backup/import-attachments', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'multipart upload required' });

    let passphrase: string | undefined;
    let fileBuffer: Buffer | undefined;
    try {
      const parts = req.parts({ limits: { fileSize: ARCHIVE_MAX_BYTES } });
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'passphrase') {
          passphrase = typeof part.value === 'string' ? part.value : undefined;
        } else if (part.type === 'file' && part.fieldname === 'file') {
          fileBuffer = await part.toBuffer();
          if (part.file.truncated) {
            return reply.code(413).send({ error: 'archive exceeds size limit' });
          }
        }
      }
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'archive exceeds size limit' });
      }
      throw err;
    }

    if (!passphrase || passphrase.length < 8) {
      return reply.code(400).send({ error: 'passphrase required (min 8 chars)' });
    }
    if (!fileBuffer || fileBuffer.length === 0) {
      return reply.code(400).send({ error: 'archive file required' });
    }

    let gzipped: Buffer;
    try {
      gzipped = decryptBytes(fileBuffer, passphrase);
    } catch (err) {
      if (err instanceof BackupDecryptError) {
        return reply.code(400).send({ error: 'wrong passphrase or corrupted archive' });
      }
      throw err;
    }

    let archive;
    try {
      archive = parseGzippedJsonToArchive(gzipped);
    } catch {
      return reply.code(400).send({ error: 'archive contents are not a valid attachments archive' });
    }

    const result = await restoreAttachmentsArchive(userId(req), archive);
    return reply.code(200).send(result);
  });
}
