import { FileUpIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { classNamesOf } from '../../shared/class-names.ts';
import type { ImportsClient } from './client.ts';
import { useImportFiles } from './import-files.ts';

export const carriesFiles = (e: Pick<DragEvent, 'dataTransfer'>) =>
  e.dataTransfer?.types.includes('Files') ?? false;

export const DropOverlay = ({ isVisible }: { isVisible: boolean }) => (
  <div
    aria-hidden="true"
    inert
    data-visible={isVisible || undefined}
    className="bg-canvas/85 pointer-events-none fixed inset-0 z-50 flex p-4 opacity-0 backdrop-blur-none transition-[opacity,backdrop-filter] duration-200 ease-out data-visible:opacity-100 data-visible:backdrop-blur-md sm:p-6"
  >
    <div
      className={classNamesOf(
        'border-primary bg-primary/5 flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-8 text-center transition-transform duration-200 ease-out',
        isVisible ? 'scale-100' : 'scale-95'
      )}
    >
      <span
        className={classNamesOf(
          'bg-primary/10 text-primary grid size-24 place-items-center rounded-full transition-transform duration-200 ease-out',
          isVisible ? 'translate-y-0' : 'translate-y-3'
        )}
      >
        <FileUpIcon className="size-12" />
      </span>
      <p className="text-2xl font-extrabold tracking-tight">Drop NEMSIS files to import</p>
      <p className="text-surface-fg-muted max-w-md text-sm">
        Each patient care report becomes its own draft claim, ready for review.
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

  return <DropOverlay isVisible={dragging} />;
};
