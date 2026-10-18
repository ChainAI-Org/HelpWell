/**
 * The support widget on Ridgeline's own pages: a question the docs answer, one
 * they do not, and what the visitor is offered when the answer falls short.
 *
 * The agent is the playground's scripted model (no key), which answers from
 * the real search the way a model is asked to: quoted, cited and scored.
 */

import { expect, nextSiblingHasClass, test, uniqueEmail } from '../fixtures';

/** In "Attach and match receipts", word for word. */
const COVERED = 'How do I forward a receipt by email?';
/** In no article. The playground's own example of a gap. */
const UNCOVERED = 'Can I import three years of history from Expensify?';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('opens and answers from the docs, citing the article it used', async ({ widget }) => {
  await widget.open();
  await widget.newConversation();

  const { answer, reply } = await widget.ask(COVERED);
  expect(reply.unresolved).toBe(false);
  await expect(answer.locator('.bubble--agent')).toContainText('receipts@ridgeline.app');

  const citation = answer.locator('.citation');
  await expect(citation).toHaveCount(1);
  await expect(citation).toHaveText('Attach and match receipts');

  // The citation opens the article inside the widget.
  await citation.click();
  await expect(widget.panel.locator('.article h1')).toHaveText('Attach and match receipts');
});

test('an unanswered question shows the email card, and saving it sets the contact', async ({
  admin,
  settings,
  widget,
}, testInfo) => {
  // Ask for the email after the first answer rather than before the first
  // question, so the card comes under the answer that left the question open.
  await settings.patch({ widget: { preChat: { when: 'unknown_only', timing: 'after' } } });
  await widget.page.reload();

  await widget.open();
  await widget.newConversation();
  const { answer, reply } = await widget.ask(UNCOVERED);
  expect(reply.unresolved).toBe(true);
  // "I could not find that" comes with no source under it.
  await expect(answer.locator('.citation')).toHaveCount(0);

  const card = widget.panel.locator('.emailCard');
  await expect(card).toHaveAttribute('data-state', 'form');
  expect(await nextSiblingHasClass(answer, 'emailCard')).toBe(true);

  const email = uniqueEmail('card', testInfo.project.name);
  await card.getByRole('textbox', { name: 'Email' }).fill(email);
  await card.getByRole('button', { name: 'Save email' }).click();
  await expect(card).toHaveAttribute('data-state', 'done');
  await expect(card).toContainText(`Thanks, we'll use ${email} for this conversation.`);

  const conversation = await admin.get<{ status: string; contact: { email: string | null } }>(
    `/admin/conversations/${reply.conversationId}`,
  );
  expect(conversation.contact.email).toBe(email);
  expect(conversation.status).toBe('unresolved');
});

test('the support email shows under an unanswered question, and only there', async ({ widget }) => {
  await widget.open();
  await widget.newConversation();
  const line = widget.panel.locator('.supportEmail--thread');

  // Saying hello earns no way out.
  const hello = await widget.ask('hi');
  expect(hello.reply.smallTalk).toBe(true);
  await expect(line).toHaveCount(0);

  // Nor does a question the docs answered.
  await widget.ask(COVERED);
  await expect(line).toHaveCount(0);

  // A question they did not answer gets it, right under that answer.
  const open = await widget.ask(UNCOVERED);
  await expect(line).toHaveCount(1);
  await expect(line.getByRole('link')).toHaveAttribute('href', 'mailto:support@ridgeline.app');
  expect(await nextSiblingHasClass(open.answer, 'supportEmail')).toBe(true);

  // Small talk after it leaves the line where it was.
  const thanks = await widget.ask('thanks');
  await expect(line).toHaveCount(1);
  expect(await nextSiblingHasClass(open.answer, 'supportEmail')).toBe(true);
  expect(await nextSiblingHasClass(thanks.answer, 'supportEmail')).toBe(false);

  // A later question that is answered takes it away.
  await widget.ask('How do approvals work?');
  await expect(line).toHaveCount(0);
});
