// Narrows a caught `unknown` to its optional string `code` field — import
// errors from importPdf / applyTemplateAndImport / previewTemplate carry a
// discriminator like 'pdf_encrypted' / 'draft_expired' /
// 'template_yielded_no_rows' that the HTTP layer branches on for status.
export function errCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const c = (err as { code: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
