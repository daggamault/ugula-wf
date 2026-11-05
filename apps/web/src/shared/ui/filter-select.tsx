import { navigate } from '../router.tsx';
import { Select } from './select.tsx';

type FilterSelectOption = {
  value: string;
  label: string;
  href: string;
};

type FilterSelectProps = {
  id: string;
  label: string;
  value: string;
  options: readonly FilterSelectOption[];
};

export const hrefOf = (options: readonly FilterSelectOption[], value: string) =>
  options.find((o) => o.value === value)?.href;

export const FilterSelect = ({ id, label, value, options }: FilterSelectProps) => (
  <div className="w-56">
    <Select
      id={id}
      label={label}
      isLabelHidden
      value={value}
      options={options}
      onChange={(v) => {
        const href = hrefOf(options, v);
        if (href) navigate(href);
      }}
    />
  </div>
);
