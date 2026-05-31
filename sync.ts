export interface LocalNote {
  path: string;
  title: string;
  content: string;
  contentHash: string;
  noteUpdatedAt: string;
}

export function chunkNotes(
  notes: LocalNote[],
  batchSize = 1,
  maxBatchBytes = 8_000_000
): LocalNote[][] {
  const batches: LocalNote[][] = [];
  let current: LocalNote[] = [];
  let currentBytes = 0;

  for (const note of notes) {
    const noteBytes =
      new TextEncoder().encode(note.content).length +
      note.path.length +
      note.title.length +
      note.contentHash.length +
      note.noteUpdatedAt.length +
      256;

    const shouldFlush =
      current.length > 0 &&
      (current.length >= batchSize || currentBytes + noteBytes > maxBatchBytes);

    if (shouldFlush) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(note);
    currentBytes += noteBytes;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}
