// Recursively collects all File objects from a drag-and-drop DataTransfer,
// walking into any subdirectories via the webkit entry API. Files that never
// resolve (e.g. permissions errors) are silently dropped — the caller sees
// only what it can actually read.
export async function collectDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const collected: File[] = [];
  const items = dt.items;
  const hasItemsApi = items && items.length > 0 &&
    typeof (items[0] as any)?.webkitGetAsEntry === 'function';

  if (hasItemsApi) {
    const walk = async (entry: any): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        await new Promise<void>((resolve) => {
          entry.file(
            (file: File) => { collected.push(file); resolve(); },
            () => resolve(),
          );
        });
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        await new Promise<void>((resolve) => {
          const readBatch = () => {
            reader.readEntries(
              async (entries: any[]) => {
                if (entries.length === 0) return resolve();
                for (const child of entries) await walk(child);
                readBatch();
              },
              () => resolve(),
            );
          };
          readBatch();
        });
      }
    };
    for (let i = 0; i < items.length; i++) {
      await walk((items[i] as any).webkitGetAsEntry?.());
    }
  }

  if (collected.length === 0 && dt.files && dt.files.length > 0) {
    collected.push(...Array.from(dt.files));
  }
  return collected;
}
