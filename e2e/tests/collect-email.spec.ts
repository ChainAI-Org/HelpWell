/**
 * The agent asking for an email itself, through its `collect_email` tool.
 *
 * The playground's scripted model answers every question from the docs,
 * except one: asking for a person, which it answers the way a model
 * following Ridgeline's playbook would, by calling `collect_email` with a
 * reason (examples/playground/lib/follow-up.ts). So this is the tool-call
 * path end to end: the tool runs in the agent loop, the reply carries the
 * ask, the widget draws the card under that answer with the model's
 * reason, the address lands on the contact, a second ask finds it on file,
 * and a reload brings the card back where it was.
 *
 * The pre-chat form is switched off, so nothing but the tool asks.
 */

import { expect, nextSiblingHasClass, test, uniqueEmail } from '../fixtures';

/** Matched by the playground's script as someone asking for a person. */
const FOLLOW_UP = 'Can someone from your team get back to me?';
/** The reason the script gives the tool (FOLLOW_UP_REASON in lib/follow-up.ts). */
const REASON = 'So someone from the Ridgeline team can get back to you.';

interface AdminThread {
  status: string;
  contact: { email: string | null };
  messages: {
    id: string;
    role: string;
    toolCalls: { name: string; arguments: Record<string, unknown>; result?: unknown }[];
  }[];
}

test.beforeEach(async ({ page, settings }) => {
  await settings.patch({ widget: { preChat: { when: 'never' } } });
  await page.goto('/');
});

test('asking for a person makes the agent ask for an email, and saving it sets the contact', async ({
  admin,
  page,
  widget,
}, testInfo) => {
  await widget.open();
  await widget.newConversation();
  // No pre-chat form: the composer is there from the start, and no card yet.
  await expect(widget.panel.getByRole('textbox', { name: 'Your message' })).toBeVisible();
  const card = widget.panel.locator('.emailCard');
  await expect(card).toHaveCount(0);

  const { answer, reply } = await widget.ask(FOLLOW_UP);
  expect(reply.askForEmail).toEqual({ reason: REASON });
  // Left open for the team, since nobody has answered it yet.
  expect(reply.unresolved).toBe(true);
  await expect(answer.locator('.bubble--agent')).toContainText(
    'Leave your email on the card below',
  );

  // The card sits right under the answer that asked, with the model's reason.
  await expect(card).toHaveAttribute('data-state', 'form');
  expect(await nextSiblingHasClass(answer, 'emailCard')).toBe(true);
  await expect(card.locator('.emailCard__reason')).toHaveText(REASON);

  const email = uniqueEmail('tool', testInfo.project.name);
  await card.getByRole('textbox', { name: 'Email' }).fill(email);
  await card.getByRole('button', { name: 'Save email' }).click();
  await expect(card).toHaveAttribute('data-state', 'done');
  await expect(card).toContainText(`Thanks, we'll use ${email} for this conversation.`);

  // What the server recorded: the call, its reason and result, and the address.
  const thread = await admin.get<AdminThread>(`/admin/conversations/${reply.conversationId}`);
  expect(thread.contact.email).toBe(email);
  expect(thread.status).toBe('unresolved');
  const asked = thread.messages.find((message) => message.id === reply.messageId);
  expect(asked?.toolCalls).toEqual([
    expect.objectContaining({
      name: 'collect_email',
      arguments: { reason: REASON },
      result: { asked: true },
    }),
  ]);

  // Asked again, the tool finds the address on file and no second card appears.
  const again = await widget.ask(FOLLOW_UP);
  expect(again.reply.askForEmail).toBeUndefined();
  await expect(again.answer.locator('.bubble--agent')).toContainText(
    'at the email they already have for you',
  );
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-state', 'done');
  const later = await admin.get<AdminThread>(`/admin/conversations/${reply.conversationId}`);
  expect(later.messages.find((message) => message.id === again.reply.messageId)?.toolCalls).toEqual(
    [
      expect.objectContaining({
        name: 'collect_email',
        result: { asked: false, reason: 'email already on file' },
      }),
    ],
  );

  // After a reload, the conversation brings the card back under the answer that asked.
  await page.reload();
  await widget.open();
  await widget.panel.getByRole('tab', { name: 'Messages' }).click();
  await widget.panel.locator('.rowlist button.row').first().click();
  await expect(widget.answers).toHaveCount(2);
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute('data-state', 'done');
  await expect(card).toContainText(email);
  expect(await nextSiblingHasClass(widget.answers.first(), 'emailCard')).toBe(true);
});
