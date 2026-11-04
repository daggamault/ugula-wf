import { FileUpIcon } from 'lucide-react';
import { useRef } from 'react';
import { Button } from './button.tsx';

type FileButtonProps = {
  label: string;
  accept?: string;
  busy: boolean;
  onFiles: (files: File[]) => void;
};

export const FileButton = ({ label, accept, busy, onFiles }: FileButtonProps) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button isPending={busy} onClick={() => input.current?.click()}>
        <FileUpIcon aria-hidden="true" className="size-4" />
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        disabled={busy}
        accept={accept}
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
    </>
  );
};
