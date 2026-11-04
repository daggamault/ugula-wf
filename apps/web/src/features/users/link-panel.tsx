import { CopyIcon } from 'lucide-react';
import { Button } from '../../shared/ui/button.tsx';
import { Input } from '../../shared/ui/input.tsx';
import { SectionPanel } from '../../shared/ui/section-panel.tsx';
import { useToast } from '../../shared/ui/toast.tsx';

export const LinkPanel = ({
  title,
  description,
  link
}: {
  title: string;
  description: string;
  link: string;
}) => {
  const notify = useToast();
  const copy = () =>
    void navigator.clipboard.writeText(link).then(
      () => notify({ title: 'Link copied' }),
      () => notify({ intent: 'danger', title: 'Could not copy the link' })
    );
  return (
    <SectionPanel
      title={title}
      description={description}
      accent="primary"
      actions={
        <Button variant="outline" onClick={copy}>
          <CopyIcon aria-hidden="true" className="size-4" />
          Copy Link
        </Button>
      }
    >
      <Input id="shared-link" label="Link" isLabelHidden readOnly isMonospace value={link} />
    </SectionPanel>
  );
};
