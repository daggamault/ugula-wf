import { navigate } from '../router.tsx';
import { Select } from './select.tsx';

export type FilterSelectOption = {
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
      value={value}
      options={options}
      onChange={(e) => {
        const href = hrefOf(options, e.target.value);
        if (href) navigate(href);
      }}
    />
  </div>
);
