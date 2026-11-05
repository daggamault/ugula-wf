import type { Locator, Page } from 'playwright-core';

const TRIGGER = 'button[aria-haspopup="listbox"]';

export const listboxTriggers = (scope: Page | Locator) => scope.locator(TRIGGER);

export const listboxByLabel = (scope: Page | Locator, label: string | RegExp, exact = false) =>
  listboxTriggers(scope).and(scope.getByLabel(label, { exact }));

const panelOf = async (trigger: Locator) =>
  trigger.page().locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);

export const optionValues = async (trigger: Locator) =>
  (await panelOf(trigger))
    .locator('[role="option"]')
    .evaluateAll((options) => options.map((o) => o.getAttribute('data-value') ?? ''));

export const chosenValue = async (trigger: Locator) =>
  (await panelOf(trigger))
    .locator('[role="option"][aria-selected="true"]')
    .evaluateAll((options) => options[0]?.getAttribute('data-value') ?? '');

export const chooseOption = async (trigger: Locator, value: string) => {
  const panel = await panelOf(trigger);
  await trigger.click();
  await panel.locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
};
