import {
  EXPR_CATEGORIES,
  exprFunctionDocs,
  exprProblem,
  freeIdentifiers,
  LIST_FORMULA_NAMES
} from '@ugula/graph';
import { Disclosure } from '../../shared/ui/disclosure.tsx';
import { Textarea } from '../../shared/ui/textarea.tsx';
import { recordOf, withEntry } from './config-schema.ts';
import type { SettingsEditorProps } from './settings-editor.ts';

export const formulaInputs = (src: string, provided: readonly string[] = []) => {
  try {
    return freeIdentifiers(src).filter((name) => !provided.includes(name));
  } catch {
    return [];
  }
};

export const formulaProblem = (src: string) =>
  src.trim() ? exprProblem(src) : 'Write a formula, such as price * units.';

const Names = ({ names }: { names: readonly string[] }) => (
  <ul className="flex flex-wrap gap-2">
    {names.map((name) => (
      <li
        key={name}
        className="bg-surface-fg/6 text-surface-fg rounded-full px-2.5 font-mono text-xs/5"
      >
        {name}
      </li>
    ))}
  </ul>
);

export const FunctionReference = () => (
  <Disclosure title="Functions">
    {EXPR_CATEGORIES.map((category) => (
      <section key={category} className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">{category}</h3>
        <dl className="flex flex-col gap-2">
          {Object.values(exprFunctionDocs)
            .filter((d) => d.category === category)
            .map((d) => (
              <div key={d.usage} className="flex flex-col gap-0.5">
                <dt className="font-mono text-xs">{d.usage}</dt>
                <dd className="text-surface-fg-muted text-xs">{d.description}</dd>
              </div>
            ))}
        </dl>
      </section>
    ))}
  </Disclosure>
);

const FormulaEditor = ({
  nodeId,
  config,
  editable,
  onConfig,
  provided
}: SettingsEditorProps & { provided: readonly string[] }) => {
  const record = recordOf(config);
  const expression = typeof record.expression === 'string' ? record.expression : '';
  const inputs = formulaInputs(expression, provided);
  return (
    <fieldset disabled={!editable} className="flex min-w-0 flex-col gap-5">
      <Textarea
        isMonospace
        id={`${nodeId}-formula`}
        label="Formula"
        error={formulaProblem(expression) ?? undefined}
        value={expression}
        onChange={(e) => onConfig(withEntry(record, 'expression', e.target.value))}
      />
      {provided.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Given for Each Item</h3>
          <Names names={provided} />
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Inputs</h3>
        {inputs.length ? (
          <>
            <Names names={inputs} />
            <p className="text-surface-fg-muted text-xs">Each name is an input to connect.</p>
          </>
        ) : (
          <p className="text-surface-fg-muted text-xs">
            Names you use in the formula become inputs to connect.
          </p>
        )}
      </section>
      <FunctionReference />
    </fieldset>
  );
};

export const ExpressionEditor = (props: SettingsEditorProps) => (
  <FormulaEditor {...props} provided={[]} />
);

export const ListFormulaEditor = (props: SettingsEditorProps) => (
  <FormulaEditor {...props} provided={LIST_FORMULA_NAMES} />
);
