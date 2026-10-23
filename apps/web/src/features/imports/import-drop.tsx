import { FileUpIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ImportsClient } from './client.ts';
import { useImportFiles } from './import-files.ts';

export const carriesFiles = (e: Pick<DragEvent, 'dataTransfer'>) =>
  e.dataTransfer?.types.includes('Files') ?? false;

export const DropOverlay = () => (
  <div
    aria-hidden="true"
    className="bg-canvas/80 animate-reveal pointer-events-none fixed inset-0 z-40 grid place-items-center p-6 backdrop-blur-sm"
  >
    <div className="border-primary bg-surface flex w-full max-w-lg flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center shadow-xl">
      <span className="bg-primary/10 text-primary grid size-14 place-items-center rounded-full">
        <FileUpIcon className="size-7" />
      </span>
      <p className="text-lg font-bold">Drop NEMSIS files to import</p>
      <p className="text-surface-fg-muted text-sm">
        Each patient care report becomes its own claim, ready for review.
      </p>
    </div>
  </div>
);

export const ImportDrop = ({ client }: { client: Pick<ImportsClient, 'upload'> }) => {
  const [dragging, setDragging] = useState(false);
  const importFiles = useImportFiles(client);

  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (carriesFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void importFiles([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  return dragging ? <DropOverlay /> : null;
};
